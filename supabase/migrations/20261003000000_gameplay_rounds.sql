-- =============================================================================
-- Core round gameplay
--
-- LOBBY → (start_game) → ROUND_WAITING → all ready → COUNTDOWN → PLAYING
--       → (all answers locked | ends_at reached) → RESULTS_READY → all ready → REVEAL
--
-- Authority model
--   * Every decision (phase, round number, letter, timing, locks, "everybody ready")
--     is made here, under the room row lock, using server time (now()).
--   * Timed transitions (COUNTDOWN → PLAYING at started_at, PLAYING → locked at
--     ends_at) are applied lazily and idempotently by advance_game(), which runs
--     inside every room RPC, including the 15 s heartbeat of every connected client.
--     Correctness never depends on the persisted phase being up to date: answer
--     writes are validated against the round timestamps themselves.
--   * ROUND_LOCKED is passed through inside the locking transaction; the persisted
--     phase after a round ends is RESULTS_READY.
--
-- Participants
--   * answer_sheets doubles as the round participant snapshot: one row per active
--     member when the round is created. No new players can join after LOBBY.
--   * Required for a ready check  = participant, not left, heartbeat fresh (45 s).
--   * Required for early round end = participant, not left (disconnected players keep
--     their full time; the timer bounds the wait).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Timing (keep in sync with src/domain/config.ts)
-- -----------------------------------------------------------------------------
create function public.countdown_duration()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '3 seconds' $$;

create function public.round_duration()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '120 seconds' $$;

create function public.eligible_letters()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'А','Б','В','Г','Д','Е','Ж','З','И','Й','К','Л','М','Н',
    'О','П','Р','С','Т','У','Ф','Х','Ц','Ч','Ш','Щ','Ю','Я'
  ];
$$;

-- Used letters must be eligible and never repeat (in addition to the existing
-- UNIQUE (room_id, letter) on rounds).
create function public.letters_are_valid(p_letters text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
           select 1 from unnest(p_letters) as l
            where l is null or not (l = any (public.eligible_letters()))
         )
     and cardinality(p_letters) = (select count(distinct l) from unnest(p_letters) as l);
$$;

alter table public.rooms
  add constraint rooms_used_letters_valid check (public.letters_are_valid(used_letters));

-- -----------------------------------------------------------------------------
-- Rounds: countdown timing and completion reason
-- -----------------------------------------------------------------------------
create type public.round_lock_reason as enum ('all_ready', 'timeout');

alter table public.rounds
  add column countdown_at timestamptz,
  add column lock_reason public.round_lock_reason,
  add constraint rounds_countdown_consistent check ((countdown_at is null) = (started_at is null)),
  add constraint rounds_countdown_before_start check (countdown_at is null or countdown_at <= started_at),
  add constraint rounds_lock_consistent check ((locked_at is null) = (lock_reason is null));

-- At most one open (unlocked) round per room.
create unique index rounds_one_open_round_per_room
  on public.rounds (room_id)
  where locked_at is null;

-- -----------------------------------------------------------------------------
-- Participants (answer_sheets) and ready checks get a room_id for scoped realtime
-- -----------------------------------------------------------------------------
create type public.sheet_lock_reason as enum (
  'ready', -- pressed "ГОТОВ" while playing
  'left'   -- left the room while the round was running
);

alter table public.answer_sheets
  add column room_id uuid references public.rooms (id) on delete cascade,
  add column lock_reason public.sheet_lock_reason;

update public.answer_sheets s
   set room_id = r.room_id
  from public.rounds r
 where r.id = s.round_id;

alter table public.answer_sheets
  alter column room_id set not null,
  add constraint answer_sheets_lock_consistent check ((submitted_at is null) = (lock_reason is null));

create index answer_sheets_room_idx on public.answer_sheets (room_id);

alter table public.ready_checks
  add column room_id uuid references public.rooms (id) on delete cascade;

update public.ready_checks c
   set room_id = r.room_id
  from public.rounds r
 where r.id = c.round_id;

alter table public.ready_checks
  alter column room_id set not null,
  -- Only round participants can be ready, and readiness is per round + stage.
  add constraint ready_checks_participant_fk
    foreign key (round_id, player_id)
    references public.answer_sheets (round_id, player_id) on delete cascade;

create index ready_checks_room_idx on public.ready_checks (room_id);

-- -----------------------------------------------------------------------------
-- Answer normalization (mirrors src/domain/normalization.ts)
-- -----------------------------------------------------------------------------
-- Stored display value: NFC, surrounding whitespace removed, casing preserved.
create function public.clean_answer(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           normalize(coalesce(p_value, ''), nfc),
           '^[\s' || chr(160) || chr(8203) || ']+|[\s' || chr(160) || chr(8203) || ']+$',
           '',
           'g'
         );
$$;

-- Duplicate-comparison key: whitespace runs collapsed, trimmed, ICU lowercase.
create function public.normalize_answer(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
           btrim(regexp_replace(public.clean_answer(p_value),
                                '[\s' || chr(160) || chr(8203) || ']+', ' ', 'g'))
           collate "und-x-icu");
$$;

-- -----------------------------------------------------------------------------
-- Round state helpers (internal)
-- -----------------------------------------------------------------------------

-- Everyone required for a ready stage has confirmed it. Required = round participant
-- who has not left and whose heartbeat is within member_stale_after(). A brief
-- network drop (< 45 s) therefore never lets a round start without someone.
create function public.all_required_ready(p_round_id uuid, p_stage public.ready_stage)
returns boolean
language sql
stable
set search_path = ''
as $$
  with required as (
    select s.player_id
      from public.answer_sheets s
      join public.room_players rp
        on rp.room_id = s.room_id and rp.player_id = s.player_id
     where s.round_id = p_round_id
       and rp.left_at is null
       and rp.last_seen_at >= now() - public.member_stale_after()
  )
  select exists (select 1 from required)
     and not exists (
           select 1
             from required q
            where not exists (
                    select 1 from public.ready_checks c
                     where c.round_id = p_round_id
                       and c.player_id = q.player_id
                       and c.stage = p_stage));
$$;

-- Every participant still in the game has locked their answers.
create function public.all_answers_locked(p_round_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
      from public.answer_sheets s
      join public.room_players rp
        on rp.room_id = s.room_id and rp.player_id = s.player_id
     where s.round_id = p_round_id
       and s.submitted_at is null
       and rp.left_at is null);
$$;

-- Applies every due transition for the room. Idempotent; callers hold the room lock.
create function public.advance_game(p_room_id uuid)
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
  -- Letters already drawn in this room (rounds.letter, UNIQUE per room) are excluded.
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

    -- rooms.used_letters is broadcast over realtime, so it is only extended when the
    -- letter is revealed (COUNTDOWN → PLAYING) — never during the countdown.
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
       where id = v_round.id;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
    elsif public.all_answers_locked(v_round.id) then
      update public.rounds
         set locked_at = now(), lock_reason = 'all_ready'
       where id = v_round.id;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
    end if;
  end if;

  -- RESULTS_READY → REVEAL once everyone required is ready for the results.
  if v_room.phase in ('ROUND_LOCKED', 'RESULTS_READY')
     and public.all_required_ready(v_round.id, 'pre_results') then
    update public.rooms set phase = 'REVEAL' where id = p_room_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Room maintenance: lobby-only seat expiry, host migration, game advancement
-- -----------------------------------------------------------------------------
create or replace function public.maintain_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_host public.room_players;
  v_candidate uuid;
  v_candidate_connected boolean;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return;
  end if;

  -- 1. Seat expiry is a LOBBY rule only. Once a game started, participants are never
  --    removed for being silent; they simply stop being required for ready checks.
  if v_room.phase = 'LOBBY' then
    update public.room_players
       set left_at = now(), left_reason = 'expired'
     where room_id = p_room_id
       and left_at is null
       and last_seen_at < now() - public.lobby_seat_expiry();
  end if;

  -- 2. Host migration. Only host_player_id changes — rounds, letters, ready states and
  --    timers are untouched.
  select * into v_host
    from public.room_players
   where room_id = p_room_id and player_id = v_room.host_player_id;

  if v_host.left_at is not null or v_host.last_seen_at < now() - public.member_stale_after() then
    v_candidate := public.elect_room_host(p_room_id, v_room.host_player_id);
    if v_candidate is not null then
      select rp.last_seen_at >= now() - public.member_stale_after()
        into v_candidate_connected
        from public.room_players rp
       where rp.room_id = p_room_id and rp.player_id = v_candidate;

      if v_host.left_at is not null or v_candidate_connected then
        update public.rooms set host_player_id = v_candidate where id = p_room_id;
      end if;
    end if;
  end if;

  -- 3. Timed and readiness-driven game transitions.
  perform public.advance_game(p_room_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- join_room / leave_room: game-aware membership
-- -----------------------------------------------------------------------------
create or replace function public.join_room(p_code text, p_display_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_code text := public.normalize_room_code(p_code);
  v_name text := public.normalize_display_name(p_display_name);
  v_key text;
  v_room public.rooms;
  v_member public.room_players;
  v_has_row boolean;
  v_active_count integer;
begin
  if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$' then
    perform public.raise_app_error('invalid_room_code');
  end if;

  select * into v_room from public.rooms where code = v_code for update;
  if not found then
    perform public.raise_app_error('room_not_found');
  end if;

  perform public.maintain_room(v_room.id);
  select * into v_room from public.rooms where id = v_room.id;

  select * into v_member
    from public.room_players
   where room_id = v_room.id and player_id = v_uid;
  v_has_row := found;

  -- Active member: refresh / second tab / reconnect.
  if v_has_row and v_member.left_at is null then
    update public.room_players
       set last_seen_at = now()
     where room_id = v_room.id and player_id = v_uid;
    return v_code;
  end if;

  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('room_finished');
  end if;

  -- A game participant who left may come back to the running game as themselves:
  -- same row, same name, same join order. Locked sheets stay locked.
  if v_room.phase <> 'LOBBY' then
    if v_has_row and exists (
      select 1 from public.answer_sheets s
       where s.room_id = v_room.id and s.player_id = v_uid
    ) then
      update public.room_players
         set left_at = null, left_reason = null, last_seen_at = now()
       where room_id = v_room.id and player_id = v_uid;
      perform public.maintain_room(v_room.id);
      return v_code;
    end if;
    perform public.raise_app_error('game_in_progress');
  end if;

  perform public.assert_valid_display_name(v_name);
  v_key := public.display_name_key(v_name);

  select count(*) into v_active_count
    from public.room_players
   where room_id = v_room.id and left_at is null;
  if v_active_count >= v_room.capacity then
    perform public.raise_app_error('room_full');
  end if;

  if exists (
    select 1 from public.room_players
     where room_id = v_room.id and left_at is null and display_name_key = v_key
  ) then
    perform public.raise_app_error('display_name_taken');
  end if;

  begin
    if v_has_row then
      update public.room_players
         set display_name = v_name,
             display_name_key = v_key,
             joined_at = now(),
             last_seen_at = now(),
             left_at = null,
             left_reason = null
       where room_id = v_room.id and player_id = v_uid;
    else
      insert into public.room_players (room_id, player_id, display_name, display_name_key)
      values (v_room.id, v_uid, v_name, v_key);
    end if;
  exception when unique_violation then
    perform public.raise_app_error('display_name_taken');
  end;

  perform public.maintain_room(v_room.id);
  return v_code;
end;
$$;

-- Leaving during a game keeps the participant record and every persisted answer.
-- If the round is already running, the player's sheet is locked as 'left' so they
-- never block the round. Host migration and stage advancement happen atomically.
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_new_host uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public.raise_app_error('not_member');
  end if;

  update public.room_players
     set left_at = now(), left_reason = 'left'
   where room_id = p_room_id and player_id = v_uid and left_at is null;
  if not found then
    perform public.raise_app_error('not_member');
  end if;

  if v_room.current_round_id is not null then
    update public.answer_sheets s
       set submitted_at = now(), lock_reason = 'left'
      from public.rounds r
     where s.round_id = v_room.current_round_id
       and s.player_id = v_uid
       and s.submitted_at is null
       and r.id = s.round_id
       and r.started_at is not null
       and r.locked_at is null;
  end if;

  if v_room.host_player_id = v_uid then
    v_new_host := public.elect_room_host(p_room_id, v_uid);
    if v_new_host is not null then
      update public.rooms set host_player_id = v_new_host where id = p_room_id;
    end if;
  end if;

  perform public.advance_game(p_room_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Gameplay RPCs
-- -----------------------------------------------------------------------------

-- Locks the room and returns it after maintenance, verifying the caller is an
-- active member and refreshing their heartbeat (an action is a sign of life).
create function public.lock_room_for_member(p_room_id uuid, p_uid uuid)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then
    perform public.raise_app_error('not_member');
  end if;

  update public.room_players
     set last_seen_at = now()
   where room_id = p_room_id and player_id = p_uid and left_at is null;
  if not found then
    perform public.raise_app_error('not_member');
  end if;

  perform public.maintain_room(p_room_id);
  select * into v_room from public.rooms where id = p_room_id;
  return v_room;
end;
$$;

-- Host starts the game: LOBBY → ROUND_WAITING with round 1 and a participant snapshot.
create function public.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_active integer;
  v_round_id uuid;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);

  if v_room.host_player_id <> v_uid then
    perform public.raise_app_error('not_host');
  end if;
  if v_room.phase <> 'LOBBY' then
    perform public.raise_app_error('game_already_started');
  end if;

  select count(*) into v_active
    from public.room_players
   where room_id = p_room_id and left_at is null;
  if v_active < 2 then
    perform public.raise_app_error('not_enough_players');
  end if;

  insert into public.rounds (room_id, round_number)
  values (
    p_room_id,
    coalesce((select max(round_number) from public.rounds where room_id = p_room_id), 0) + 1
  )
  returning id into v_round_id;

  insert into public.answer_sheets (round_id, player_id, room_id)
  select v_round_id, rp.player_id, p_room_id
    from public.room_players rp
   where rp.room_id = p_room_id and rp.left_at is null;

  update public.rooms
     set phase = 'ROUND_WAITING', current_round_id = v_round_id
   where id = p_room_id;
end;
$$;

-- Shared body of both ready stages. Idempotent: repeated calls are no-ops, and a
-- retry that arrives after the stage already completed succeeds silently.
create function public.confirm_ready_stage(
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

create function public.set_round_ready(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.confirm_ready_stage(p_room_id, 'pre_round', array['ROUND_WAITING']::public.game_phase[]);
$$;

create function public.set_results_ready(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.confirm_ready_stage(
    p_room_id, 'pre_results', array['ROUND_LOCKED', 'RESULTS_READY']::public.game_phase[]);
$$;

-- Saves (a subset of) the caller's answers for the current round.
-- p_answers: {"country": "...", "city": "...", ...}. Validated against server time.
-- Serialized per player through the answer_sheets row lock (no room lock needed:
-- a round can only end early once this player's sheet is locked, and the timeout is
-- checked against ends_at directly).
create function public.save_answers(p_room_id uuid, p_round_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_round public.rounds;
  v_sheet public.answer_sheets;
  v_entry record;
  v_value text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    perform public.raise_app_error('invalid_answers');
  end if;

  if not exists (
    select 1 from public.room_players
     where room_id = p_room_id and player_id = v_uid and left_at is null
  ) then
    perform public.raise_app_error('not_member');
  end if;

  if not exists (
    select 1 from public.rooms where id = p_room_id and current_round_id = p_round_id
  ) then
    perform public.raise_app_error('round_not_active');
  end if;

  select * into v_sheet
    from public.answer_sheets
   where round_id = p_round_id and player_id = v_uid
   for update;
  if not found then
    perform public.raise_app_error('not_participant');
  end if;
  if v_sheet.submitted_at is not null then
    perform public.raise_app_error('answers_locked');
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.started_at is null or now() < v_round.started_at then
    perform public.raise_app_error('wrong_phase');
  end if;
  if v_round.locked_at is not null or now() >= v_round.ends_at then
    perform public.raise_app_error('round_over');
  end if;

  for v_entry in select key, value from jsonb_each(p_answers) loop
    if v_entry.key not in ('country', 'city', 'village', 'animal', 'plant', 'object', 'name') then
      perform public.raise_app_error('invalid_category');
    end if;
    if jsonb_typeof(v_entry.value) <> 'string' then
      perform public.raise_app_error('invalid_answers');
    end if;
    v_value := public.clean_answer(v_entry.value #>> '{}');
    if char_length(v_value) > 100 then
      perform public.raise_app_error('answer_too_long');
    end if;

    insert into public.answers (round_id, player_id, category, raw_value, normalized_value)
    values (p_round_id, v_uid, v_entry.key::public.answer_category, v_value, public.normalize_answer(v_value))
    on conflict (round_id, player_id, category)
    do update set raw_value = excluded.raw_value, normalized_value = excluded.normalized_value;
  end loop;

  update public.answer_sheets set updated_at = now()
   where round_id = p_round_id and player_id = v_uid;
end;
$$;

-- "ГОТОВ" while playing: final lock of the caller's answers for this round.
-- Idempotent; a call after the round already ended succeeds without changes.
create function public.lock_answers(p_room_id uuid, p_round_id uuid)
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

-- Read model for the game screens. Reveals the letter only once the authoritative
-- start time has passed, and returns the server clock for client offset estimation.
create function public.get_game_state(p_room_id uuid)
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
      'lock_reason', v_round.lock_reason
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

-- -----------------------------------------------------------------------------
-- Privacy
-- -----------------------------------------------------------------------------

-- The letter is drawn when the countdown starts but must stay secret until
-- started_at. Clients cannot select rounds.letter; get_game_state reveals it.
revoke select on public.rounds from authenticated;
grant select (id, room_id, round_number, started_at, ends_at, locked_at, created_at,
              countdown_at, lock_reason)
  on public.rounds to authenticated;

-- Other players' answers become readable only in the reveal/results phases of their
-- round (or once a later round is current). During PLAYING and RESULTS_READY only the
-- author can read an answer — the host included.
create function public.round_answers_revealed(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rounds r
      join public.rooms rm on rm.id = r.room_id
     where r.id = p_round_id
       and r.locked_at is not null
       and (rm.current_round_id is distinct from r.id
            or rm.phase in ('REVEAL', 'RESULTS', 'FINISHED')));
$$;

drop policy "members read locked round answers" on public.answers;

create policy "members read revealed round answers"
  on public.answers for select to authenticated
  using (public.is_round_member(round_id) and public.round_answers_revealed(round_id));

-- -----------------------------------------------------------------------------
-- Realtime: readiness and lock state (never answer content, never rounds.letter)
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.answer_sheets, public.ready_checks;

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
