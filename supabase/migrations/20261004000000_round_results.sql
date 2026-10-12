-- =============================================================================
-- Round results: synchronized reveal, server-side scoring, host invalidation
--
-- RESULTS_READY → (all ready) → REVEAL [reveal_at fixed] → (reveal_at + 11 s) → RESULTS
--
-- Scoring is DERIVED, never stored: round_cells() computes every cell from the
-- source of truth (answers + invalidation state) each time it is read. There are no
-- score columns a client (or a bug) could get out of sync or write to.
--
-- Scoring order per category (authoritative):
--   1. take the submitted answer          (missing row = empty)
--   2. empty / non-empty                   (normalized value '' = empty → 0)
--   3. drop host-invalidated answers       (invalid → 0, excluded from grouping)
--   4. normalize remaining valid answers   (answers.normalized_value)
--   5. group duplicates per category
--   6. group size > 1 → every member 0     (duplicate)
--   7. group size = 1 → 1                  (unique)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reveal timeline (keep in sync with src/domain/reveal.ts)
-- -----------------------------------------------------------------------------
create function public.reveal_duration()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '11 seconds' $$;

alter table public.rounds
  add column reveal_at timestamptz,
  add constraint rounds_reveal_after_lock check (reveal_at is null or locked_at is not null);

-- Columns readable by clients (the letter stays non-selectable, see migration 3).
grant select (reveal_at) on public.rounds to authenticated;

-- Bumped on every invalidation/restore. rooms is published to Realtime, so every
-- client learns "results changed" without the answers table being broadcast.
alter table public.rooms
  add column results_revision integer not null default 0;

-- -----------------------------------------------------------------------------
-- Invalidation audit trail (current state lives on answers.invalidated_*)
-- -----------------------------------------------------------------------------
create type public.invalidation_action as enum ('invalidate', 'restore');

create table public.answer_invalidation_events (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  round_id   uuid not null,
  player_id  uuid not null,
  category   public.answer_category not null,
  action     public.invalidation_action not null,
  actor_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (round_id, player_id, category)
    references public.answers (round_id, player_id, category) on delete cascade
);

create index answer_invalidation_events_round_idx
  on public.answer_invalidation_events (round_id, created_at);

-- Audit rows are internal: no client access at all (RLS on, no policies, no grants).
alter table public.answer_invalidation_events enable row level security;
revoke all on public.answer_invalidation_events from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Scoring (mirrors classifyCategoryAnswers in src/domain/scoring.ts)
-- -----------------------------------------------------------------------------
create function public.round_cells(p_round_id uuid)
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
  with cells as (
    select s.player_id,
           c.category,
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

-- A round's results are visible from REVEAL on (or once a later round is current).
-- Same rule as answer visibility (round_answers_revealed, migration 3).
create function public.round_results_visible(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.round_answers_revealed(p_round_id);
$$;

-- -----------------------------------------------------------------------------
-- Game advancement: reveal timeline + REVEAL → RESULTS
-- -----------------------------------------------------------------------------
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

  -- ROUND_WAITING → COUNTDOWN: draw a random unused letter, fix the timeline.
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

  -- COUNTDOWN → PLAYING once the authoritative start time has passed.
  if v_room.phase = 'COUNTDOWN' and now() >= v_round.started_at then
    update public.rooms
       set phase = 'PLAYING',
           used_letters = used_letters || v_round.letter
     where id = p_room_id
     returning * into v_room;
  end if;

  -- PLAYING → (ROUND_LOCKED) → RESULTS_READY on timeout or when everyone locked.
  if v_room.phase = 'PLAYING' then
    if now() >= v_round.ends_at then
      update public.rounds
         set locked_at = v_round.ends_at, lock_reason = 'timeout'
       where id = v_round.id
       returning * into v_round;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
    elsif public.all_answers_locked(v_round.id) then
      update public.rounds
         set locked_at = now(), lock_reason = 'all_ready'
       where id = v_round.id
       returning * into v_round;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
    end if;
  end if;

  -- RESULTS_READY → REVEAL: fix the single, shared reveal timeline (under the room
  -- lock, so concurrent final "ready" requests establish exactly one reveal_at).
  if v_room.phase in ('ROUND_LOCKED', 'RESULTS_READY')
     and public.all_required_ready(v_round.id, 'pre_results') then
    update public.rounds
       set reveal_at = now()
     where id = v_round.id and reveal_at is null
     returning * into v_round;
    select * into v_round from public.rounds where id = v_room.current_round_id;
    update public.rooms set phase = 'REVEAL' where id = p_room_id returning * into v_room;
  end if;

  -- REVEAL → RESULTS once the reveal sequence has played out (server time).
  if v_room.phase = 'REVEAL'
     and v_round.reveal_at is not null
     and now() >= v_round.reveal_at + public.reveal_duration() then
    update public.rooms set phase = 'RESULTS' where id = p_room_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read models
-- -----------------------------------------------------------------------------

-- get_game_state now also returns the reveal timeline.
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
begin
  if not public.is_room_member(p_room_id) then
    perform public.raise_app_error('not_member');
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  select * into v_round from public.rounds where id = v_room.current_round_id;

  return jsonb_build_object(
    'server_now', v_now,
    'phase', v_room.phase,
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

-- Results of one round (default: the current round) plus cumulative game totals.
-- Only for active members, and only once the round has been revealed. Rows are in the
-- stable round-participant order (join order); cumulative totals sum every revealed
-- round of the room, so later rounds extend the same model.
create function public.get_round_results(p_room_id uuid, p_round_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
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

  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'phase', v_room.phase,
    'round', jsonb_build_object(
      'id', v_round.id,
      'number', v_round.round_number,
      'letter', v_round.letter,
      'reveal_at', v_round.reveal_at,
      'lock_reason', v_round.lock_reason
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', s.player_id,
               'display_name', rp.display_name,
               'left', rp.left_at is not null,
               'round_points', (select coalesce(sum(c.points), 0) from public.round_cells(v_round.id) c
                                 where c.player_id = s.player_id),
               'total_points', (
                 select coalesce(sum(c.points), 0)
                   from public.rounds r
                  cross join lateral public.round_cells(r.id) c
                  where r.room_id = p_room_id
                    and c.player_id = s.player_id
                    and public.round_results_visible(r.id)
               ),
               'cells', (
                 select jsonb_agg(jsonb_build_object(
                          'category', c.category,
                          'answer', c.answer,
                          'state', c.state,
                          'points', c.points,
                          'duplicate_count', c.duplicate_count
                        ) order by array_position(enum_range(null::public.answer_category), c.category))
                   from public.round_cells(v_round.id) c
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

-- -----------------------------------------------------------------------------
-- Host invalidation / restoration
-- -----------------------------------------------------------------------------
-- Only the CURRENT host (checked after maintenance, i.e. after any due host
-- migration), only for the current round, only in REVEAL / RESULTS, only for a
-- non-empty answer of a participant. Idempotent: setting the state it already has is
-- a no-op (no audit event). Serialized by the room lock, so concurrent requests end
-- in a consistent state. Scores follow automatically because they are derived.
create function public.set_answer_invalidated(
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
   where round_id = p_round_id
     and player_id = p_player_id
     and category = p_category::public.answer_category
   for update;
  if not found or v_answer.normalized_value = '' then
    perform public.raise_app_error('answer_empty');
  end if;

  if (v_answer.invalidated_at is not null) = p_invalidated then
    return; -- already in the requested state
  end if;

  update public.answers
     set invalidated_at = case when p_invalidated then now() end,
         invalidated_by = case when p_invalidated then v_uid end
   where round_id = p_round_id
     and player_id = p_player_id
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

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_round_member(uuid) to authenticated;
grant execute on function public.can_access_room_topic(text) to authenticated;
grant execute on function public.round_answers_revealed(uuid) to authenticated;

grant execute on function public.create_room(text, integer) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.set_round_ready(uuid) to authenticated;
grant execute on function public.save_answers(uuid, uuid, jsonb) to authenticated;
grant execute on function public.lock_answers(uuid, uuid) to authenticated;
grant execute on function public.set_results_ready(uuid) to authenticated;
grant execute on function public.get_game_state(uuid) to authenticated;
grant execute on function public.get_round_results(uuid, uuid) to authenticated;
grant execute on function public.set_answer_invalidated(uuid, uuid, uuid, text, boolean) to authenticated;
