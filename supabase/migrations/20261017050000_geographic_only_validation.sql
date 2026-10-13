-- Keep the geographic checks, but leave non-geographic answers for the host.
update public.answers a
   set validation_status = 'PENDING',
       validation_reason = null,
       validation_suggestion = null,
       validated_at = null
 where a.category not in ('country', 'city', 'village')
   and exists (
     select 1
       from public.rounds r
      where r.id = a.round_id and r.reveal_at is null
   );

update public.rooms set phase = 'MAP_VALIDATING' where phase = 'AI_VALIDATING';

update public.geographic_validation_cache
   set result = (result - 'model') || jsonb_build_object('provider', 'geoapify')
 where result ->> 'model' = 'geoapify';

create or replace function public.advance_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_letter text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.current_round_id is null then
    return;
  end if;
  select * into v_round from public.rounds where id = v_room.current_round_id for update;

  if v_room.phase = 'ROUND_WAITING' and public.all_required_ready(v_round.id, 'pre_round') then
    select l into v_letter
      from unnest(public.eligible_letters()) as l
     where not exists (
             select 1 from public.rounds r
              where r.room_id = p_room_id and r.letter = l)
     order by gen_random_uuid()
     limit 1;

    if v_letter is null then
      update public.rooms set phase = 'FINISHED' where id = p_room_id;
      return;
    end if;

    update public.rounds
       set letter = v_letter,
           countdown_at = now(),
           started_at = now() + public.countdown_duration(),
           ends_at = now() + public.countdown_duration() + public.round_duration()
     where id = v_round.id
     returning * into v_round;

    update public.rooms
       set phase = 'COUNTDOWN'
     where id = p_room_id
     returning * into v_room;
  end if;

  if v_room.phase = 'COUNTDOWN' and clock_timestamp() >= v_round.started_at then
    update public.rooms
       set phase = 'PLAYING',
           used_letters = used_letters || v_round.letter
     where id = p_room_id
     returning * into v_room;
  end if;

  if v_room.phase = 'PLAYING' and clock_timestamp() >= v_round.ends_at then
    update public.rounds
       set locked_at = v_round.ends_at, lock_reason = 'timeout'
     where id = v_round.id
     returning * into v_round;
    update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase in ('ROUND_LOCKED', 'RESULTS_READY')
     and public.all_required_ready(v_round.id, 'pre_results') then
    update public.rounds
       set validation_started_at = clock_timestamp(),
           validation_finished_at = null,
           validation_claim = null,
           validation_claimed_at = null,
           validation_attempts = 0
     where id = v_round.id;
    update public.rooms set phase = 'MAP_VALIDATING' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'MAP_VALIDATING'
     and v_round.validation_started_at < clock_timestamp() - interval '180 seconds' then
    update public.rounds
       set validation_finished_at = clock_timestamp(),
           reveal_at = clock_timestamp(),
           validation_claim = null,
           validation_claimed_at = null
     where id = v_round.id returning * into v_round;
    update public.rooms set phase = 'REVEAL' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'REVEAL'
     and v_round.reveal_at is not null
     and clock_timestamp() >= v_round.reveal_at + public.reveal_duration() then
    update public.rooms set phase = 'RESULTS' where id = p_room_id;
  end if;
end;
$$;

create or replace function public.claim_geographic_validation(p_room_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  if v_room.phase <> 'MAP_VALIDATING' or v_round.locked_at is null then return null; end if;
  if v_round.validation_attempts >= 3 then return null; end if;
  if v_round.validation_claim is not null
     and v_round.validation_claimed_at > clock_timestamp() - interval '90 seconds' then return null; end if;

  v_claim := gen_random_uuid();
  update public.rounds
     set validation_claim = v_claim,
         validation_claimed_at = clock_timestamp(),
         validation_attempts = validation_attempts + 1
   where id = p_round_id;

  return jsonb_build_object(
    'claim', v_claim,
    'letter', v_round.letter,
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', player_id, 'category', category, 'value', raw_value)
             order by player_id, category), '[]'::jsonb)
        from public.answers
       where round_id = p_round_id and category in ('country', 'city', 'village')
    )
  );
end;
$$;

create or replace function public.release_geographic_validation(p_round_id uuid, p_claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  select room_id into v_room_id from public.rounds where id = p_round_id;
  perform 1 from public.rooms where id = v_room_id for update;
  update public.rounds
     set validation_claim = null, validation_claimed_at = null
   where id = p_round_id and validation_claim = p_claim and validation_finished_at is null;
end;
$$;

create or replace function public.complete_geographic_validation(
  p_room_id uuid,
  p_round_id uuid,
  p_claim uuid,
  p_results jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
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
  if v_room.phase <> 'MAP_VALIDATING' or p_claim is null
     or v_round.validation_claim is distinct from p_claim then return false; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    perform public.raise_app_error('invalid_validation_payload');
  end if;

  select count(*) into v_expected
    from public.answers
   where round_id = p_round_id and category in ('country', 'city', 'village');
  if jsonb_array_length(p_results) <> v_expected or (
    select count(distinct (i ->> 'player_id', i ->> 'category'))
      from jsonb_array_elements(p_results) i
  ) <> v_expected then
    perform public.raise_app_error('invalid_validation_payload');
  end if;

  for v_item in select value from jsonb_array_elements(p_results) loop
    if coalesce(v_item ->> 'status', '') not in ('VALID', 'INVALID')
       or coalesce(v_item ->> 'category', '') not in ('country', 'city', 'village')
       or not exists (
         select 1 from public.answers
          where round_id = p_round_id
            and player_id::text = v_item ->> 'player_id'
            and category::text = v_item ->> 'category'
       )
       or (v_item ->> 'status' = 'VALID' and v_item ->> 'reason' is not null)
       or (v_item ->> 'status' = 'INVALID' and coalesce(v_item ->> 'reason', '') not in
           ('WRONG_LETTER', 'MISSPELLING', 'DOES_NOT_EXIST', 'WRONG_CATEGORY', 'AMBIGUOUS'))
       or char_length(coalesce(v_item ->> 'suggestion', '')) > 100 then
      perform public.raise_app_error('invalid_validation_payload');
    end if;
    update public.answers
       set validation_status = (v_item ->> 'status')::public.answer_validation_status,
           validation_reason = case
             when v_item ->> 'reason' is null then null
             else (v_item ->> 'reason')::public.answer_validation_reason
           end,
           validation_suggestion = nullif(v_item ->> 'suggestion', ''),
           validated_at = clock_timestamp()
     where round_id = p_round_id
       and player_id = (v_item ->> 'player_id')::uuid
       and category = (v_item ->> 'category')::public.answer_category;
  end loop;

  update public.rounds
     set validation_finished_at = clock_timestamp(),
         reveal_at = clock_timestamp(),
         validation_claim = null,
         validation_claimed_at = null
   where id = p_round_id;
  update public.rooms set phase = 'REVEAL' where id = p_room_id;
  return true;
end;
$$;

revoke all on function public.claim_geographic_validation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_geographic_validation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_geographic_validation(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_geographic_validation(uuid, uuid) to service_role;
grant execute on function public.release_geographic_validation(uuid, uuid) to service_role;
grant execute on function public.complete_geographic_validation(uuid, uuid, uuid, jsonb) to service_role;

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

create or replace function public.get_round_results(p_room_id uuid, p_round_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_standings jsonb;
begin
  if not public.is_room_member(p_room_id) then
    perform public.raise_app_error('not_member');
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  select * into v_round
    from public.rounds
   where id = coalesce(p_round_id, v_room.current_round_id) and room_id = p_room_id;
  if not found then
    perform public.raise_app_error('round_not_active');
  end if;
  if not public.round_results_visible(v_round.id) then
    perform public.raise_app_error('results_not_available');
  end if;

  v_standings := public.standings_through(p_room_id, v_round.round_number);
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'phase', v_room.phase,
    'round', jsonb_build_object(
      'id', v_round.id,
      'number', v_round.round_number,
      'letter', v_round.letter,
      'reveal_at', v_round.reveal_at,
      'lock_reason', v_round.lock_reason,
      'is_current', v_round.id = v_room.current_round_id
    ),
    'standings', v_standings,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', s.player_id,
               'display_name', rp.display_name,
               'left', rp.left_at is not null,
               'round_points', (select coalesce(sum(c.points), 0) from public.round_cells(v_round.id) c
                                 where c.player_id = s.player_id),
               'total_points', coalesce((
                 select (e ->> 'total_points')::integer
                   from jsonb_array_elements(v_standings) e
                  where e ->> 'player_id' = s.player_id::text), 0),
               'cells', (
                 select jsonb_agg(jsonb_build_object(
                          'category', c.category,
                          'answer', c.answer,
                          'state', c.state,
                          'points', c.points,
                          'duplicate_count', c.duplicate_count,
                          'validation_reason', a.validation_reason,
                          'validation_suggestion', a.validation_suggestion,
                          'host_invalidated', a.invalidated_at is not null
                        ) order by array_position(enum_range(null::public.answer_category), c.category))
                   from public.round_cells(v_round.id) c
                   left join public.answers a on a.round_id = v_round.id
                     and a.player_id = c.player_id and a.category = c.category
                  where c.player_id = s.player_id
               )
             ) order by rp.joined_at, s.player_id)
        from public.answer_sheets s
        join public.room_players rp on rp.room_id = s.room_id and rp.player_id = s.player_id
       where s.round_id = v_round.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_answer_invalidated(
  p_room_id uuid,
  p_round_id uuid,
  p_player_id uuid,
  p_category text,
  p_invalidated boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_answer public.answers;
  v_geographic_invalid boolean;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);
  if v_room.host_player_id <> v_uid then
    perform public.raise_app_error('not_host');
  end if;
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;
  if v_room.phase not in ('REVEAL', 'RESULTS') then
    perform public.raise_app_error('results_not_available');
  end if;
  if p_invalidated is null then
    perform public.raise_app_error('invalid_answers');
  end if;
  if p_category is null or p_category not in ('country', 'city', 'village', 'animal', 'plant', 'object', 'name') then
    perform public.raise_app_error('invalid_category');
  end if;

  select * into v_answer
    from public.answers
   where round_id = p_round_id and player_id = p_player_id
     and category = p_category::public.answer_category
   for update;
  if not found or v_answer.normalized_value = '' then
    perform public.raise_app_error('answer_empty');
  end if;

  v_geographic_invalid := v_answer.validation_status = 'INVALID';
  if (v_answer.invalidated_at is not null or v_geographic_invalid) = p_invalidated then
    return;
  end if;

  update public.answers
     set invalidated_at = case when p_invalidated then now() end,
         invalidated_by = case when p_invalidated then v_uid end,
         validation_status = case
           when not p_invalidated and validation_status = 'INVALID' then 'VALID'
           else validation_status
         end,
         validation_reason = case
           when not p_invalidated and validation_status = 'INVALID' then null
           else validation_reason
         end,
         validation_suggestion = case
           when not p_invalidated and validation_status = 'INVALID' then null
           else validation_suggestion
         end,
         validated_at = case
           when not p_invalidated and validation_status = 'INVALID' then clock_timestamp()
           else validated_at
         end
   where round_id = p_round_id and player_id = p_player_id
     and category = p_category::public.answer_category;

  insert into public.answer_invalidation_events (room_id, round_id, player_id, category, action, actor_id)
  values (
    p_room_id, p_round_id, p_player_id, p_category::public.answer_category,
    case when p_invalidated then 'invalidate'::public.invalidation_action else 'restore'::public.invalidation_action end,
    v_uid
  );
  update public.rooms set results_revision = results_revision + 1 where id = p_room_id;
end;
$$;

drop function if exists public.set_ai_validation_pending(uuid);
drop function if exists public.complete_ai_validation(uuid, uuid, jsonb);
drop function if exists public.claim_ai_validation(uuid, uuid);
drop function if exists public.release_ai_validation(uuid, uuid);
drop function if exists public.complete_ai_validation(uuid, uuid, uuid, jsonb);
drop table if exists public.round_validations;
notify pgrst, 'reload schema';
