-- Remove automatic answer validation. Google Maps remains a user-opened preview only.
update public.rooms
   set phase = 'REVEAL'
 where phase = 'MAP_VALIDATING';

update public.rounds r
   set reveal_at = coalesce(r.reveal_at, clock_timestamp())
  from public.rooms rm
 where rm.current_round_id = r.id
   and rm.phase = 'REVEAL'
   and r.reveal_at is null;

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
  if not found or v_room.current_round_id is null then return; end if;
  select * into v_round from public.rounds where id = v_room.current_round_id for update;

  if v_room.phase = 'ROUND_WAITING' and public.all_required_ready(v_round.id, 'pre_round') then
    select l into v_letter
      from unnest(public.eligible_letters()) as l
     where not exists (
       select 1 from public.rounds r where r.room_id = p_room_id and r.letter = l)
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
    update public.rooms set phase = 'COUNTDOWN' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'COUNTDOWN' and clock_timestamp() >= v_round.started_at then
    update public.rooms
       set phase = 'PLAYING', used_letters = used_letters || v_round.letter
     where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'PLAYING' and clock_timestamp() >= v_round.ends_at then
    update public.rounds
       set locked_at = v_round.ends_at, lock_reason = 'timeout'
     where id = v_round.id returning * into v_round;
    update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase in ('ROUND_LOCKED', 'RESULTS_READY')
     and public.all_required_ready(v_round.id, 'pre_results') then
    update public.rounds set reveal_at = now()
     where id = v_round.id and reveal_at is null returning * into v_round;
    select * into v_round from public.rounds where id = v_room.current_round_id;
    update public.rooms set phase = 'REVEAL' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'REVEAL' and v_round.reveal_at is not null
     and clock_timestamp() >= v_round.reveal_at + public.reveal_duration() then
    update public.rooms set phase = 'RESULTS' where id = p_room_id;
  end if;
end;
$$;

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
      from public.rounds r where r.id = p_round_id
  ),
  cells as (
    select s.player_id, c.category,
           coalesce(a.raw_value, '') as answer,
           coalesce(a.normalized_value, '') as normalized,
           a.invalidated_at is not null as invalidated
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
  select k.player_id, k.category, k.answer,
         coalesce(k.excluded_state, case when g.size > 1 then 'duplicate' else 'unique' end),
         case when k.excluded_state is null and g.size = 1 then 1 else 0 end,
         coalesce(g.size, 0)
    from classified k
    left join groups g on g.category = k.category and g.normalized = k.normalized;
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
  select * into v_round from public.rounds
   where id = coalesce(p_round_id, v_room.current_round_id) and room_id = p_room_id;
  if not found then perform public.raise_app_error('round_not_active'); end if;
  if not public.round_results_visible(v_round.id) then
    perform public.raise_app_error('results_not_available');
  end if;

  v_standings := public.standings_through(p_room_id, v_round.round_number);
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'phase', v_room.phase,
    'round', jsonb_build_object(
      'id', v_round.id, 'number', v_round.round_number, 'letter', v_round.letter,
      'reveal_at', v_round.reveal_at, 'lock_reason', v_round.lock_reason,
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
          select (e ->> 'total_points')::integer from jsonb_array_elements(v_standings) e
           where e ->> 'player_id' = s.player_id::text
        ), 0),
        'cells', (
          select jsonb_agg(jsonb_build_object(
            'category', c.category, 'answer', c.answer, 'state', c.state,
            'points', c.points, 'duplicate_count', c.duplicate_count,
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
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);
  if v_room.host_player_id <> v_uid then perform public.raise_app_error('not_host'); end if;
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;
  if v_room.phase not in ('REVEAL', 'RESULTS') then
    perform public.raise_app_error('results_not_available');
  end if;
  if p_invalidated is null then perform public.raise_app_error('invalid_answers'); end if;
  if p_category is null or p_category not in
      ('country', 'city', 'village', 'animal', 'plant', 'object', 'name') then
    perform public.raise_app_error('invalid_category');
  end if;

  select * into v_answer from public.answers
   where round_id = p_round_id and player_id = p_player_id
     and category = p_category::public.answer_category
   for update;
  if not found or v_answer.normalized_value = '' then
    perform public.raise_app_error('answer_empty');
  end if;
  if (v_answer.invalidated_at is not null) = p_invalidated then return; end if;

  update public.answers
     set invalidated_at = case when p_invalidated then now() end,
         invalidated_by = case when p_invalidated then v_uid end
   where round_id = p_round_id and player_id = p_player_id
     and category = p_category::public.answer_category;

  insert into public.answer_invalidation_events
    (room_id, round_id, player_id, category, action, actor_id)
  values (
    p_room_id, p_round_id, p_player_id, p_category::public.answer_category,
    case when p_invalidated then 'invalidate'::public.invalidation_action
         else 'restore'::public.invalidation_action end,
    v_uid
  );
  update public.rooms set results_revision = results_revision + 1 where id = p_room_id;
end;
$$;

drop function if exists public.claim_geographic_validation(uuid, uuid);
drop function if exists public.release_geographic_validation(uuid, uuid);
drop function if exists public.complete_geographic_validation(uuid, uuid, uuid, jsonb);
drop function if exists public.set_ai_validation_pending(uuid);
drop function if exists public.complete_ai_validation(uuid, uuid, jsonb);
drop function if exists public.claim_ai_validation(uuid, uuid);
drop function if exists public.release_ai_validation(uuid, uuid);
drop function if exists public.complete_ai_validation(uuid, uuid, uuid, jsonb);

drop table if exists public.geographic_validation_cache;
drop table if exists public.round_validations;
alter table public.answers
  drop column if exists validation_status,
  drop column if exists validation_reason,
  drop column if exists validation_suggestion,
  drop column if exists validated_at;
alter table public.rounds
  drop column if exists validation_started_at,
  drop column if exists validation_finished_at,
  drop column if exists validation_claim,
  drop column if exists validation_claimed_at,
  drop column if exists validation_attempts;

drop type if exists public.answer_validation_status;
drop type if exists public.answer_validation_reason;

notify pgrst, 'reload schema';
