-- Room-serialized leases prevent concurrent clients from paying for the same job.
create function public.claim_ai_validation(p_room_id uuid, p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_claim uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.current_round_id is distinct from p_round_id then return null; end if;
  perform public.advance_game(p_room_id);
  select * into v_room from public.rooms where id = p_room_id;
  select * into v_round from public.rounds where id = p_round_id and room_id = p_room_id;
  if v_room.phase <> 'AI_VALIDATING' or v_round.locked_at is null then return null; end if;
  if v_round.validation_attempts >= 3 then return null; end if;
  if v_round.validation_claim is not null
     and v_round.validation_claimed_at > clock_timestamp() - interval '90 seconds' then return null; end if;
  v_claim := gen_random_uuid();
  update public.rounds set validation_claim = v_claim, validation_claimed_at = clock_timestamp(),
         validation_attempts = validation_attempts + 1
   where id = p_round_id;
  return jsonb_build_object('claim', v_claim, 'letter', v_round.letter, 'answers', (
    select coalesce(jsonb_agg(jsonb_build_object('player_id', player_id,
             'category', category, 'value', raw_value) order by player_id, category), '[]'::jsonb)
      from public.answers where round_id = p_round_id
  ));
end;
$$;

create function public.release_ai_validation(p_round_id uuid, p_claim uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room_id uuid;
begin
  select room_id into v_room_id from public.rounds where id = p_round_id;
  perform 1 from public.rooms where id = v_room_id for update;
  update public.rounds set validation_claim = null, validation_claimed_at = null
   where id = p_round_id and validation_claim = p_claim and validation_finished_at is null;
end;
$$;

create function public.complete_ai_validation(p_room_id uuid, p_round_id uuid, p_claim uuid, p_results jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_item jsonb;
  v_expected integer;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.current_round_id is distinct from p_round_id then return false; end if;
  perform public.advance_game(p_room_id);
  select * into v_room from public.rooms where id = p_room_id;
  select * into v_round from public.rounds where id = p_round_id and room_id = p_room_id;
  if v_room.phase <> 'AI_VALIDATING' or p_claim is null
     or v_round.validation_claim is distinct from p_claim then return false; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    perform public.raise_app_error('invalid_validation_payload');
  end if;
  select count(*) into v_expected from public.answers where round_id = p_round_id;
  if jsonb_array_length(p_results) <> v_expected or (
    select count(distinct (i ->> 'player_id', i ->> 'category')) from jsonb_array_elements(p_results) i
  ) <> v_expected then perform public.raise_app_error('invalid_validation_payload'); end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    if coalesce(v_item ->> 'status', '') not in ('VALID', 'INVALID')
       or not exists (select 1 from public.answers where round_id = p_round_id
           and player_id::text = v_item ->> 'player_id' and category::text = v_item ->> 'category')
       or (v_item ->> 'status' = 'VALID' and v_item ->> 'reason' is not null)
       or (v_item ->> 'status' = 'INVALID' and coalesce(v_item ->> 'reason', '') not in
           ('WRONG_LETTER', 'MISSPELLING', 'DOES_NOT_EXIST', 'WRONG_CATEGORY', 'AMBIGUOUS'))
       or char_length(coalesce(v_item ->> 'suggestion', '')) > 100
       or char_length(coalesce(v_item ->> 'model', '')) > 128 then
      perform public.raise_app_error('invalid_validation_payload');
    end if;
    update public.answers set
      validation_status = (v_item ->> 'status')::public.answer_validation_status,
      validation_reason = (v_item ->> 'reason')::public.answer_validation_reason,
      validation_suggestion = nullif(v_item ->> 'suggestion', ''), validated_at = clock_timestamp()
     where round_id = p_round_id and player_id = (v_item ->> 'player_id')::uuid
       and category = (v_item ->> 'category')::public.answer_category;
    insert into public.round_validations
      (room_id, round_id, player_id, category, answer, validation_status, validation_reason, validation_suggestion, model)
    select p_room_id, round_id, player_id, category, raw_value, validation_status,
           validation_reason, validation_suggestion, coalesce(v_item ->> 'model', 'gpt-4.1-mini')
      from public.answers where round_id = p_round_id and player_id = (v_item ->> 'player_id')::uuid
       and category = (v_item ->> 'category')::public.answer_category
    on conflict (round_id, player_id, category) do nothing;
  end loop;
  update public.rounds set validation_finished_at = clock_timestamp(), reveal_at = clock_timestamp(),
         validation_claim = null, validation_claimed_at = null where id = p_round_id;
  update public.rooms set phase = 'REVEAL' where id = p_room_id;
  return true;
end;
$$;

revoke all on function public.claim_ai_validation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_ai_validation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_ai_validation(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_ai_validation(uuid, uuid) to service_role;
grant execute on function public.release_ai_validation(uuid, uuid) to service_role;
grant execute on function public.complete_ai_validation(uuid, uuid, uuid, jsonb) to service_role;
notify pgrst, 'reload schema';

-- AI-invalid answers do not score and do not create duplicates.
create or replace function public.round_cells(p_round_id uuid)
returns table (
  player_id uuid,
  category public.answer_category,
  answer text,
  state text,
  points integer,
  duplicate_count integer
)
language sql
stable
set search_path = ''
as $$
  with round_letter as (
    select lower(r.letter collate "und-x-icu") as letter
      from public.rounds r
     where r.id = p_round_id
  ),
  cells as (
    select s.player_id,
           c.category,
           coalesce(a.raw_value, '') as answer,
           coalesce(a.normalized_value, '') as normalized,
           (a.invalidated_at is not null or a.validation_status = 'INVALID') as invalidated
      from public.answer_sheets s
     cross join unnest(enum_range(null::public.answer_category)) as c (category)
      left join public.answers a
        on a.round_id = s.round_id and a.player_id = s.player_id and a.category = c.category
     where s.round_id = p_round_id
  ),
  classified as (
    select cells.*,
           case
             when normalized = '' then 'empty'
             when left(normalized, 1) is distinct from (select letter from round_letter)
               then 'wrong_letter'
             when invalidated then 'invalid'
           end as excluded_state
      from cells
  ),
  groups as (
    select g.category, g.normalized, count(*)::integer as size
      from classified g
     where g.excluded_state is null
     group by g.category, g.normalized
  )
  select k.player_id,
         k.category,
         k.answer,
         coalesce(k.excluded_state, case when g.size > 1 then 'duplicate' else 'unique' end),
         case when k.excluded_state is null and g.size = 1 then 1 else 0 end,
         coalesce(g.size, 0)
    from classified k
    left join groups g on g.category = k.category and g.normalized = k.normalized;
$$;

-- Read model exposes the fallback flag without disclosing answers.
create or replace function public.get_game_state(p_room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_now timestamptz := clock_timestamp();
  v_used integer;
begin
  if not public.is_room_member(p_room_id) then
    perform public.raise_app_error('not_member');
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  select * into v_round from public.rounds where id = v_room.current_round_id;
  -- Letters count only once revealed, so the draw of the current round stays secret
  -- during its countdown.
  select count(*)::integer into v_used
    from public.rounds r
   where r.room_id = p_room_id and r.letter is not null and r.started_at <= v_now;

  return jsonb_build_object(
    'server_now', v_now,
    'phase', v_room.phase,
    'finished_at', v_room.finished_at,
    'progress', jsonb_build_object(
      'total_rounds', public.total_rounds(),
      'letters_used', v_used,
      'rounds_completed', (
        select count(*) from public.rounds r
         where r.room_id = p_room_id and r.reveal_at is not null),
      'is_final_round', coalesce(v_round.round_number, 0) = public.total_rounds(),
      'eligible_players', (select count(*) from public.eligible_round_players(p_room_id))
    ),
    'revealed_rounds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.round_number, 'letter', r.letter)
                       order by r.round_number)
        from public.rounds r
       where r.room_id = p_room_id and public.round_answers_revealed(r.id)
    ), '[]'::jsonb),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id,
      'number', v_round.round_number,
      'letter', case when v_round.started_at <= v_now then v_round.letter end,
      'countdown_at', v_round.countdown_at,
      'started_at', v_round.started_at,
      'ends_at', v_round.ends_at,
      'locked_at', v_round.locked_at,
      'lock_reason', v_round.lock_reason,
      'validation_timed_out', exists (select 1 from public.round_validations
        where round_id = v_round.id and model = 'validation-timeout'),
      'reveal_at', v_round.reveal_at
    ) end,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', s.player_id,
               'display_name', rp.display_name,
               'joined_at', rp.joined_at,
               'last_seen_at', rp.last_seen_at,
               'left', rp.left_at is not null,
               'round_ready', exists (
                 select 1 from public.ready_checks c
                  where c.round_id = s.round_id and c.player_id = s.player_id and c.stage = 'pre_round'),
               'answers_locked_at', s.submitted_at,
               'answers_lock_reason', s.lock_reason,
               'results_ready', exists (
                 select 1 from public.ready_checks c
                  where c.round_id = s.round_id and c.player_id = s.player_id and c.stage = 'pre_results')
             ) order by rp.joined_at, s.player_id)
        from public.answer_sheets s
        join public.room_players rp on rp.room_id = s.room_id and rp.player_id = s.player_id
       where s.round_id = v_round.id
    ), '[]'::jsonb)
  );
end;
$$;
