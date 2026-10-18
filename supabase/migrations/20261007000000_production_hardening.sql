-- =============================================================================
-- Production hardening (Web v1.0)
--
--  1. Per-identity rate limiting of every API request (PostgREST pre-request hook)
--  2. Request-size guard (rejects oversized bodies before any work is done)
--  3. Cheap size guards in front of text normalization (no regex over megabytes)
--  4. Room-code guessing limit: failed join lookups are counted (and survive) —
--     join_room now returns NULL for "no such room" instead of raising
--  5. Retention / cleanup of abandoned rooms, finished games, stale rate counters and
--     orphaned anonymous users, scheduled with pg_cron when available
--  6. Indexes for the cascades that cleanup relies on
--
-- Additive only: no existing data is changed; existing functions keep their contracts
-- except join_room's "not found" signal (see 4, client updated in the same release).
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Rate limiting
-- -----------------------------------------------------------------------------
-- Limits are data, so operators can tune them without a deploy:
--   update private.rate_limit_rules set max_requests = … where op = '…';
-- Fixed windows per (identity, operation). Budgets are generous multiples of what a
-- real player does in a 15-player game (see docs/security.md); they exist to stop
-- runaway scripts, not to shape normal play.
create table private.rate_limit_rules (
  op text primary key,
  max_requests integer not null check (max_requests > 0),
  window_seconds integer not null check (window_seconds between 1 and 86400)
);

insert into private.rate_limit_rules (op, max_requests, window_seconds) values
  -- Rare actions.
  ('create_room',            10,  600),  -- 10 rooms per 10 minutes
  ('join_room',              30,   60),
  ('join_room_miss',         20,  600),  -- failed code lookups (guessing)
  ('leave_room',             30,   60),
  ('start_game',             30,   60),
  ('start_next_round',       30,   60),
  ('finish_game',            30,   60),
  ('set_round_ready',        60,   60),
  ('set_results_ready',      60,   60),
  ('lock_answers',           60,   60),
  ('set_answer_invalidated', 120,  60),
  -- Frequent by design.
  ('heartbeat',              120,  60),  -- normal: ~4–8 per minute
  ('save_answers',           600,  60),  -- normal: ≤ 2 per second while typing
  ('report_visibility',      240,  60),
  -- Reads (refetched on realtime events; bursty with 15 players).
  ('get_game_state',        1200,  60),
  ('get_round_results',      600,  60),
  ('get_round_activity',     900,  60),
  ('get_game_summary',       300,  60),
  ('default',                600,  60);  -- anything else

-- Counters are disposable (UNLOGGED: no WAL, lost on crash — acceptable for limits).
create unlogged table private.rate_limit_counters (
  user_id uuid not null,
  op text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (user_id, op, window_start)
);

-- Counts one request for (caller, op) and raises rate_limited above the budget.
-- Counted inside the caller's transaction: a request that fails for another reason
-- is not counted (it did no work either). Guessing is the exception, see 4.
create function private.hit_rate_limit(p_uid uuid, p_op text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule private.rate_limit_rules;
  v_window timestamptz;
  v_hits integer;
begin
  select * into v_rule from private.rate_limit_rules where op = p_op;
  if not found then
    select * into v_rule from private.rate_limit_rules where op = 'default';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / v_rule.window_seconds)
                           * v_rule.window_seconds);
  insert into private.rate_limit_counters as c (user_id, op, window_start, hits)
  values (p_uid, v_rule.op, v_window, 1)
  on conflict (user_id, op, window_start) do update set hits = c.hits + 1
  returning hits into v_hits;

  if v_hits > v_rule.max_requests then
    perform public.raise_app_error('rate_limited');
  end if;
end;
$$;

-- 2. Largest legitimate request body: save_answers with 7 × 100 characters of
-- Cyrillic (≈ 1.5 KB). Anything far beyond is rejected before parsing work.
create function private.max_request_bytes()
returns integer
language sql
immutable
set search_path = ''
as $$ select 16384 $$;

-- PostgREST pre-request hook: runs before every API request, in its transaction, as
-- the request's role. Signed-in callers are counted per operation; everyone gets the
-- size guard. The service role (server-side tooling) is never limited.
create function private.check_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_path text := coalesce(current_setting('request.path', true), '');
  v_length bigint;
  v_uid uuid;
begin
  if coalesce(v_claims ->> 'role', '') = 'service_role' then
    return;
  end if;

  v_length := case
    when (v_headers ->> 'content-length') ~ '^[0-9]{1,18}$'
      then (v_headers ->> 'content-length')::bigint
  end;
  if v_length > private.max_request_bytes() then
    perform public.raise_app_error('payload_too_large');
  end if;

  -- GET/HEAD run in read-only transactions (no counter can be written there). Reads
  -- are RLS-protected and cheap; their volume is a platform/gateway concern.
  if coalesce(current_setting('request.method', true), '') in ('GET', 'HEAD') then
    return;
  end if;

  v_uid := nullif(v_claims ->> 'sub', '')::uuid;
  if v_uid is null then
    return; -- anon role: has no access to anything anyway
  end if;

  perform private.hit_rate_limit(
    v_uid,
    case when v_path like '/rpc/%' then substr(v_path, 6) else 'default' end
  );
end;
$$;

-- Every API role passes through the hook (the service role is never limited, see above).
grant usage on schema private to anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.check_request() to anon, authenticated, service_role;

-- Activate the hook (picked up after PostgREST reloads its configuration).
alter role authenticator set pgrst.db_pre_request = 'private.check_request';
notify pgrst, 'reload config';

-- -----------------------------------------------------------------------------
-- 3. Size guards before normalization (behaviour for valid input is unchanged)
-- -----------------------------------------------------------------------------
create or replace function public.normalize_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- Names are at most 20 characters; anything this long is invalid anyway.
  if char_length(p_name) > 200 then
    -- Same shape as raise_app_error (which is not IMMUTABLE).
    raise exception using errcode = 'P0001', message = 'invalid_display_name', hint = 'app_error';
  end if;
  return btrim(regexp_replace(normalize(coalesce(p_name, ''), nfc), '\s+', ' ', 'g'));
end;
$$;

create or replace function public.normalize_room_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Codes are 5 characters; absurdly long input normalizes to '' (invalid code).
  select case
    when char_length(p_code) > 64 then ''
    else left(regexp_replace(upper(coalesce(p_code, '')),
                             '[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]', '', 'g'), 5)
  end;
$$;

create or replace function public.clean_answer(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- Answers are at most 100 characters after trimming; reject far longer input
  -- before running Unicode normalization and regular expressions over it.
  if char_length(p_value) > 400 then
    raise exception using errcode = 'P0001', message = 'answer_too_long', hint = 'app_error';
  end if;
  return regexp_replace(
           normalize(coalesce(p_value, ''), nfc),
           '^[\s' || chr(160) || chr(8203) || ']+|[\s' || chr(160) || chr(8203) || ']+$',
           '',
           'g');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. join_room: count failed lookups so codes cannot be guessed at scale
-- -----------------------------------------------------------------------------
-- An exception rolls back everything in the request — including any counter — so a
-- raised "room_not_found" could never be rate limited. A miss therefore returns NULL
-- (the client maps it to "room not found") and its counter commits.
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
    perform private.hit_rate_limit(v_uid, 'join_room_miss');
    return null;
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

-- -----------------------------------------------------------------------------
-- 5. Retention and cleanup
-- -----------------------------------------------------------------------------
-- Retention policy (also in docs/operations.md):
--   never-started rooms (LOBBY)         24 h after the last sign of life of anyone
--   abandoned games (in progress)       24 h after the last sign of life of anyone
--   finished games                       7 days after finished_at
--   rate-limit counters                  2 h
--   anonymous users without any room   30 days after their last sign-in
create function private.retention_inactive_room() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;
create function private.retention_finished_room() returns interval
language sql immutable set search_path = '' as $$ select interval '7 days' $$;
create function private.retention_anonymous_user() returns interval
language sql immutable set search_path = '' as $$ select interval '30 days' $$;

-- Last sign of life in a room: the most recent heartbeat/action of any member (left
-- or not), or the room's creation.
create function private.room_last_activity(p_room_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
           r.created_at,
           r.updated_at,
           coalesce((select max(rp.last_seen_at) from public.room_players rp
                      where rp.room_id = r.id), r.created_at))
    from public.rooms r
   where r.id = p_room_id;
$$;

create function private.room_is_expired(p_room public.rooms)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_room.phase = 'FINISHED' then
      coalesce(p_room.finished_at, private.room_last_activity(p_room.id))
        < now() - private.retention_finished_room()
    else
      private.room_last_activity(p_room.id) < now() - private.retention_inactive_room()
  end;
$$;

-- Deletes expired rooms (all game data cascades), stale counters and orphaned
-- anonymous users. Each room is locked (SKIP LOCKED: a room in use is never waited
-- on) and its expiry re-checked under the lock, so a player reconnecting at the last
-- moment — whose heartbeat takes the same room lock — always wins.
create function private.cleanup_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_rooms integer := 0;
  v_counters integer := 0;
  v_users integer := 0;
begin
  for v_room in
    select r.* from public.rooms r
     where private.room_is_expired(r)
     order by r.created_at
     limit 500
  loop
    perform 1 from public.rooms where id = v_room.id for update skip locked;
    if not found then
      continue;
    end if;
    select * into v_room from public.rooms where id = v_room.id;
    if private.room_is_expired(v_room) then
      delete from public.rooms where id = v_room.id;
      v_rooms := v_rooms + 1;
    end if;
  end loop;

  delete from private.rate_limit_counters where window_start < now() - interval '2 hours';
  get diagnostics v_counters = row_count;

  -- Anonymous identities that belong to no room any more and were not used for a long
  -- time. A returning visitor simply gets a fresh anonymous identity.
  with doomed as (
    select u.id
      from auth.users u
     where u.is_anonymous
       and coalesce(u.last_sign_in_at, u.created_at) < now() - private.retention_anonymous_user()
       and not exists (select 1 from public.room_players rp where rp.player_id = u.id)
     limit 1000
  )
  delete from auth.users u using doomed where u.id = doomed.id;
  get diagnostics v_users = row_count;

  return jsonb_build_object('rooms', v_rooms, 'rate_counters', v_counters,
                            'anonymous_users', v_users);
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.check_request() to anon, authenticated, service_role;

-- Schedule hourly when pg_cron is available (Supabase: Database → Extensions →
-- pg_cron). Without it, the function can be scheduled by any other means.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('cleanup-expired-data', '17 * * * *',
                          'select private.cleanup_expired_data()');
  else
    raise notice 'pg_cron is not available: schedule private.cleanup_expired_data() manually';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Indexes for cascades and SET NULL actions when users/rooms are deleted
-- -----------------------------------------------------------------------------
-- Without these, deleting one anonymous user scans these tables completely.
create index if not exists answer_sheets_player_idx on public.answer_sheets (player_id);
create index if not exists ready_checks_player_idx on public.ready_checks (player_id);
create index if not exists visibility_events_player_idx on public.visibility_events (player_id);
create index if not exists answers_invalidated_by_idx
  on public.answers (invalidated_by) where invalidated_by is not null;
create index if not exists answer_invalidation_events_actor_idx
  on public.answer_invalidation_events (actor_id) where actor_id is not null;

-- -----------------------------------------------------------------------------
-- 7. Performance: standings computed with one round_cells() pass per round
-- -----------------------------------------------------------------------------
-- The original joined round_cells(round) laterally per answer sheet, recomputing each
-- round 15 times (420 evaluations for 15 players × 28 rounds, ~215 ms locally). Same
-- result, one evaluation per round.
create or replace function public.standings_through(p_room_id uuid, p_round_number integer)
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
      select c.player_id,
             count(distinct r.id)::integer as rounds_played,
             coalesce(sum(c.points), 0)::integer as total_points
        from public.rounds r
       cross join lateral public.round_cells(r.id) c
       where r.room_id = p_room_id
         and r.round_number <= p_round_number
         and public.round_answers_revealed(r.id)
       group by c.player_id
    ) p
    join public.room_players rp on rp.room_id = p_room_id and rp.player_id = p.player_id;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: re-assert the client surface (unchanged set of 17 RPCs + RLS helpers)
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
grant execute on function public.report_visibility(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.get_round_activity(uuid, uuid) to authenticated;
