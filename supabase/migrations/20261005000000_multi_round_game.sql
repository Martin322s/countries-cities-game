-- =============================================================================
-- Full 28-round game loop and finalization
--
-- RESULTS ──start_next_round (host)──▶ ROUND_WAITING ──▶ … ──▶ RESULTS   (rounds 1–27)
-- RESULTS of round 28 ──finish_game (host)──▶ FINISHED
--
-- Guarantees
--   * Round numbers are sequential (1, 2, … 28) — enforced by a trigger, the existing
--     CHECK (1..28) and UNIQUE (room_id, round_number).
--   * Each letter appears once per room — UNIQUE (room_id, letter) + draw query.
--   * At most one open round per room — partial unique index (migration 3).
--   * A round's participant snapshot is written only by the transaction that creates
--     the round and is never changed afterwards (trigger).
--   * Historical rounds are read-only: invalidation is limited to the current round in
--     REVEAL/RESULTS (migration 4), so starting the next round freezes the previous one.
--   * FINISHED is terminal: no rounds, ready checks, answer writes or invalidations.
-- =============================================================================

create function public.total_rounds()
returns integer
language sql
immutable
set search_path = ''
as $$ select cardinality(public.eligible_letters()) $$;

alter table public.rooms add column finished_at timestamptz;

-- -----------------------------------------------------------------------------
-- Sequential round numbers
-- -----------------------------------------------------------------------------
create function public.rounds_enforce_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expected integer;
begin
  select coalesce(max(round_number), 0) + 1 into v_expected
    from public.rounds
   where room_id = new.room_id;
  if new.round_number <> v_expected then
    raise exception 'round_number % is not the next round (expected %)', new.round_number, v_expected
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rounds_sequential_numbers
  before insert on public.rounds
  for each row execute function public.rounds_enforce_sequence();

-- -----------------------------------------------------------------------------
-- Immutable participant snapshots
-- -----------------------------------------------------------------------------
-- Inside one transaction now() is constant, so "the round was created in this very
-- transaction" is exactly rounds.created_at = now(). Anything else would add a
-- participant to an existing round, which is never allowed.
create function public.answer_sheets_snapshot_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select created_at from public.rounds where id = new.round_id) is distinct from now() then
      raise exception 'participant snapshot of round % is immutable', new.round_id
        using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.round_id <> old.round_id or new.player_id <> old.player_id or new.room_id <> old.room_id then
      raise exception 'participant snapshot of round % is immutable', old.round_id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger answer_sheets_snapshot_immutable
  before insert or update on public.answer_sheets
  for each row execute function public.answer_sheets_snapshot_guard();

-- -----------------------------------------------------------------------------
-- Participant eligibility for a new round
-- -----------------------------------------------------------------------------
-- Eligible = room member who has not left AND whose heartbeat is fresh
-- (member_stale_after(), 45 s). A participant who left or vanished is not added to
-- new rounds; their earlier rounds stay in history. If they come back (same
-- identity, join_room) before the next snapshot, they are included again.
create function public.eligible_round_players(p_room_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select rp.player_id
    from public.room_players rp
   where rp.room_id = p_room_id
     and rp.left_at is null
     and rp.last_seen_at >= now() - public.member_stale_after()
   order by rp.joined_at, rp.player_id;
$$;

create function public.letters_used(p_room_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.rounds where room_id = p_room_id and letter is not null;
$$;

-- -----------------------------------------------------------------------------
-- start_next_round
-- -----------------------------------------------------------------------------
-- Host only, from RESULTS only. Creates round N+1 with a fresh participant snapshot
-- and moves the room to ROUND_WAITING. Does NOT draw a letter or start any timer —
-- that happens exactly like round 1 once every required player is ready.
create function public.start_next_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_current public.rounds;
  v_round_id uuid;
  v_eligible integer;
begin
  -- Locks the room, refreshes the caller's heartbeat, applies due transitions
  -- (e.g. REVEAL → RESULTS) and host migration.
  v_room := public.lock_room_for_member(p_room_id, v_uid);

  if v_room.host_player_id <> v_uid then
    perform public.raise_app_error('not_host');
  end if;
  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('game_finished');
  end if;
  if v_room.phase = 'ROUND_WAITING' then
    perform public.raise_app_error('round_already_started');
  end if;
  if v_room.phase <> 'RESULTS' then
    perform public.raise_app_error('wrong_phase');
  end if;

  select * into v_current from public.rounds where id = v_room.current_round_id;
  if v_current.locked_at is null or v_current.reveal_at is null then
    perform public.raise_app_error('wrong_phase');
  end if;
  if public.letters_used(p_room_id) >= public.total_rounds() then
    perform public.raise_app_error('no_letters_left');
  end if;

  select count(*) into v_eligible from public.eligible_round_players(p_room_id);
  if v_eligible < 2 then
    perform public.raise_app_error('not_enough_players');
  end if;

  insert into public.rounds (room_id, round_number)
  values (p_room_id, v_current.round_number + 1)
  returning id into v_round_id;

  insert into public.answer_sheets (round_id, player_id, room_id)
  select v_round_id, player_id, p_room_id
    from public.eligible_round_players(p_room_id) as player_id;

  update public.rooms
     set phase = 'ROUND_WAITING', current_round_id = v_round_id
   where id = p_room_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- finish_game
-- -----------------------------------------------------------------------------
-- Host only, after round 28 has reached RESULTS (all letters used). A deliberate
-- action so the group can still review/invalidate the final round first.
-- Idempotent: calling it on a finished game is a no-op.
create function public.finish_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_current public.rounds;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);

  if v_room.phase = 'FINISHED' then
    return;
  end if;
  if v_room.host_player_id <> v_uid then
    perform public.raise_app_error('not_host');
  end if;
  if v_room.phase <> 'RESULTS' then
    perform public.raise_app_error('wrong_phase');
  end if;

  select * into v_current from public.rounds where id = v_room.current_round_id;
  if public.letters_used(p_room_id) < public.total_rounds()
     or v_current.round_number <> public.total_rounds() then
    perform public.raise_app_error('letters_remaining');
  end if;

  update public.rooms
     set phase = 'FINISHED', finished_at = now()
   where id = p_room_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- FINISHED is terminal for ready checks and personal locks
-- -----------------------------------------------------------------------------
create or replace function public.confirm_ready_stage(
  p_room_id uuid,
  p_stage public.ready_stage,
  p_allowed_phases public.game_phase[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);

  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('game_finished');
  end if;

  if v_room.current_round_id is null or not exists (
    select 1 from public.answer_sheets
     where round_id = v_room.current_round_id and player_id = v_uid
  ) then
    perform public.raise_app_error('not_participant');
  end if;

  if not (v_room.phase = any (p_allowed_phases)) then
    if exists (
      select 1 from public.ready_checks
       where round_id = v_room.current_round_id and player_id = v_uid and stage = p_stage
    ) then
      return;
    end if;
    perform public.raise_app_error('wrong_phase');
  end if;

  insert into public.ready_checks (round_id, player_id, stage, room_id)
  values (v_room.current_round_id, v_uid, p_stage, p_room_id)
  on conflict (round_id, player_id, stage) do nothing;

  perform public.advance_game(p_room_id);
end;
$$;

create or replace function public.lock_answers(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_round public.rounds;
  v_sheet public.answer_sheets;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);

  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('game_finished');
  end if;

  select * into v_sheet
    from public.answer_sheets
   where round_id = p_round_id and player_id = v_uid and room_id = p_room_id
   for update;
  if not found then
    perform public.raise_app_error('not_participant');
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if v_sheet.submitted_at is not null or v_round.locked_at is not null then
    return;
  end if;
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;
  if v_round.started_at is null or now() < v_round.started_at then
    perform public.raise_app_error('wrong_phase');
  end if;

  update public.answer_sheets
     set submitted_at = now(), lock_reason = 'ready'
   where round_id = p_round_id and player_id = v_uid;

  perform public.advance_game(p_room_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Read models
-- -----------------------------------------------------------------------------

-- Cumulative standings after a given round: every player who took part in any
-- revealed round up to and including that round number. Absence from a round adds
-- nothing (no rows are fabricated). Order: stable join order.
create function public.standings_through(p_room_id uuid, p_round_number integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', p.player_id,
           'display_name', rp.display_name,
           'left', rp.left_at is not null,
           'total_points', p.total_points,
           'rounds_played', p.rounds_played
         ) order by rp.joined_at, p.player_id), '[]'::jsonb)
    from (
      select s.player_id,
             count(distinct s.round_id)::integer as rounds_played,
             coalesce(sum(c.points), 0)::integer as total_points
        from public.answer_sheets s
        join public.rounds r on r.id = s.round_id
        left join lateral public.round_cells(r.id) c on c.player_id = s.player_id
       where s.room_id = p_room_id
         and r.round_number <= p_round_number
         and public.round_answers_revealed(r.id)
       group by s.player_id
    ) p
    join public.room_players rp on rp.room_id = p_room_id and rp.player_id = p.player_id;
$$;

-- Results of one round (default: current) with totals "as of that round", plus the
-- full standings (including players who missed the round).
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

-- get_game_state now carries the game progress and the list of revealed rounds
-- (for history browsing). Unused / future letters are never exposed.
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

-- Final (or current) game summary: standings over every revealed round.
create function public.get_game_summary(p_room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if not public.is_room_member(p_room_id) then
    perform public.raise_app_error('not_member');
  end if;
  select * into v_room from public.rooms where id = p_room_id;
  return jsonb_build_object(
    'phase', v_room.phase,
    'finished_at', v_room.finished_at,
    'code', v_room.code,
    'total_rounds', public.total_rounds(),
    'rounds_completed', (
      select count(*) from public.rounds r where r.room_id = p_room_id and r.reveal_at is not null),
    'standings', public.standings_through(p_room_id, public.total_rounds())
  );
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
grant execute on function public.start_next_round(uuid) to authenticated;
grant execute on function public.finish_game(uuid) to authenticated;
grant execute on function public.get_game_summary(uuid) to authenticated;
