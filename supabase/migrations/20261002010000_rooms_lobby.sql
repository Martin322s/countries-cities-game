-- =============================================================================
-- Rooms & realtime lobby
--
-- Adds the server-authoritative room lifecycle:
--   create_room · join_room (incl. rejoin) · leave_room · heartbeat
-- plus lazy server-side maintenance (stale seat expiry + host migration),
-- hardened privileges, Realtime publication and Realtime channel authorization.
--
-- Concurrency model: every mutating RPC first locks the room row
-- (SELECT … FOR UPDATE). All room-scoped writes are therefore serialized per room,
-- which makes capacity checks, name-uniqueness checks and host election atomic.
-- Lock order is always rooms → room_players to avoid deadlocks.
--
-- Timing constants mirror src/domain/config.ts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Membership bookkeeping
-- -----------------------------------------------------------------------------
create type public.member_left_reason as enum (
  'left',    -- pressed "НАПУСНИ СТАЯТА"
  'expired'  -- no heartbeat for longer than lobby_seat_expiry() while in LOBBY
);

-- Canonical display name: NFC, internal whitespace collapsed, trimmed.
-- Mirrors sanitizeDisplayName() in src/domain/players.ts.
create function public.normalize_display_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(normalize(coalesce(p_name, ''), nfc), '\s+', ' ', 'g'));
$$;

-- Case-insensitive comparison key. ICU lowercasing handles Cyrillic regardless of
-- the database's default collation. Mirrors displayNameKey() in the domain layer.
create function public.display_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(public.normalize_display_name(p_name) collate "und-x-icu");
$$;

alter table public.room_players
  add column display_name_key text,
  add column left_reason public.member_left_reason;

update public.room_players
   set display_name_key = public.display_name_key(display_name);

alter table public.room_players
  alter column display_name_key set not null,
  add constraint room_players_display_name_canonical
    check (display_name = public.normalize_display_name(display_name)),
  add constraint room_players_display_name_key_matches
    check (display_name_key = public.display_name_key(display_name)),
  add constraint room_players_left_consistent
    check ((left_at is null) = (left_reason is null));

-- No two ACTIVE members of a room may share a name (case-insensitively).
-- Members who left keep their row (history, rejoin) but free the name.
create unique index room_players_active_name_uq
  on public.room_players (room_id, display_name_key)
  where left_at is null;

create index room_players_active_idx
  on public.room_players (room_id, joined_at)
  where left_at is null;

-- One membership row per (room, user) is already guaranteed by the primary key
-- (room_id, player_id): refreshes and rejoins reuse that row.

-- -----------------------------------------------------------------------------
-- Timing (keep in sync with src/domain/config.ts)
-- -----------------------------------------------------------------------------
-- A member whose last heartbeat is older than this is considered disconnected.
-- The host keeps the role during this grace period.
create function public.member_stale_after()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '45 seconds' $$;

-- In LOBBY, a member silent for this long loses their seat.
create function public.lobby_seat_expiry()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 minutes' $$;

-- -----------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- -----------------------------------------------------------------------------

-- Expected business errors carry a stable machine code in MESSAGE and the marker
-- 'app_error' in HINT. The client maps the code; it never parses free text.
create function public.raise_app_error(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, hint = 'app_error';
end;
$$;

create function public.normalize_room_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(regexp_replace(upper(coalesce(p_code, '')), '[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]', '', 'g'), 5);
$$;

-- 5 characters from the unambiguous alphabet, using gen_random_uuid() (CSPRNG)
-- as the entropy source with rejection sampling (248 = 31 * 8) to avoid modulo bias.
create function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  random_bytes bytea;
  value integer;
begin
  while char_length(code) < 5 loop
    random_bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      -- Bytes 6 and 8 carry UUID version/variant bits and are not uniformly random.
      continue when i in (6, 8);
      value := get_byte(random_bytes, i);
      continue when value >= 248;
      code := code || substr(alphabet, (value % 31) + 1, 1);
      exit when char_length(code) = 5;
    end loop;
  end loop;
  return code;
end;
$$;

-- Deterministic host election, mirrors selectNextHost() in src/domain/players.ts:
-- connected members first, then earliest joined_at, then lowest player_id.
create function public.elect_room_host(p_room_id uuid, p_excluding uuid default null)
returns uuid
language sql
stable
set search_path = ''
as $$
  select rp.player_id
    from public.room_players rp
   where rp.room_id = p_room_id
     and rp.left_at is null
     and rp.player_id is distinct from p_excluding
   order by (rp.last_seen_at >= now() - public.member_stale_after()) desc,
            rp.joined_at,
            rp.player_id
   limit 1;
$$;

-- Lazy, idempotent room maintenance. Runs inside every room RPC (heartbeats arrive
-- every ~15 s from each connected client), so no scheduler is required while
-- anyone is in the room. Caller must already hold the room row lock.
create function public.maintain_room(p_room_id uuid)
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

  -- 1. Release lobby seats held by members who vanished without leaving.
  if v_room.phase = 'LOBBY' then
    update public.room_players
       set left_at = now(), left_reason = 'expired'
     where room_id = p_room_id
       and left_at is null
       and last_seen_at < now() - public.lobby_seat_expiry();
  end if;

  -- 2. Host migration.
  select * into v_host
    from public.room_players
   where room_id = p_room_id and player_id = v_room.host_player_id;

  if v_host.left_at is null and v_host.last_seen_at >= now() - public.member_stale_after() then
    return; -- host present and connected (or within grace period)
  end if;

  v_candidate := public.elect_room_host(p_room_id, v_room.host_player_id);
  if v_candidate is null then
    return; -- nobody to hand over to; keep the current host value
  end if;

  select rp.last_seen_at >= now() - public.member_stale_after()
    into v_candidate_connected
    from public.room_players rp
   where rp.room_id = p_room_id and rp.player_id = v_candidate;

  -- A host who LEFT is always replaced. A host who is merely stale is only replaced
  -- by a connected member (never swap one disconnected host for another).
  if v_host.left_at is not null or v_candidate_connected then
    update public.rooms set host_player_id = v_candidate where id = p_room_id;
  end if;
end;
$$;

create function public.assert_authenticated()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform public.raise_app_error('not_authenticated');
  end if;
  return v_uid;
end;
$$;

create function public.assert_valid_display_name(p_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_name is null or char_length(p_name) < 1 or char_length(p_name) > 20 then
    perform public.raise_app_error('invalid_display_name');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Creates a room with the caller as its first member and host.
-- Returns the canonical room code.
create function public.create_room(p_display_name text, p_capacity integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_name text := public.normalize_display_name(p_display_name);
  v_room_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  perform public.assert_valid_display_name(v_name);
  if p_capacity is null or p_capacity < 2 or p_capacity > 15 then
    perform public.raise_app_error('invalid_capacity');
  end if;

  -- Server-side code generation with collision retry. 31^5 ≈ 28.6M codes, so a
  -- collision is rare; repeated collisions indicate something is badly wrong.
  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_room_code();
    begin
      insert into public.rooms (code, capacity, host_player_id)
      values (v_code, p_capacity, v_uid)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        perform public.raise_app_error('room_code_unavailable');
      end if;
    end;
  end loop;

  -- rooms_host_is_member is DEFERRABLE INITIALLY DEFERRED, so the host row may
  -- follow the room row inside this transaction.
  insert into public.room_players (room_id, player_id, display_name, display_name_key)
  values (v_room_id, v_uid, v_name, public.display_name_key(v_name));

  return v_code;
end;
$$;

-- Joins a room by code, or restores the caller's existing membership (rejoin).
-- Returns the canonical room code.
--
-- Rules:
--   * Active member (refresh / second tab / reconnect): always succeeds, no changes
--     besides refreshing last_seen_at. Display name stays as it was.
--   * New member, or a member who left/expired: only while the room is in LOBBY;
--     the existing row is reused (same identity) with a fresh joined_at.
create function public.join_room(p_code text, p_display_name text)
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

  select * into v_member
    from public.room_players
   where room_id = v_room.id and player_id = v_uid;
  v_has_row := found;

  if v_has_row and v_member.left_at is null then
    update public.room_players
       set last_seen_at = now()
     where room_id = v_room.id and player_id = v_uid;
    return v_code;
  end if;

  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('room_finished');
  elsif v_room.phase <> 'LOBBY' then
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
    -- Defence in depth: the partial unique index is the final authority on names.
    perform public.raise_app_error('display_name_taken');
  end;

  -- If the room was empty (host gone), the newcomer is elected here.
  perform public.maintain_room(v_room.id);

  return v_code;
end;
$$;

-- Intentionally leaves a room. If the caller is host, the role is handed over
-- atomically in the same transaction.
create function public.leave_room(p_room_id uuid)
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

  if v_room.host_player_id = v_uid then
    v_new_host := public.elect_room_host(p_room_id, v_uid);
    if v_new_host is not null then
      update public.rooms set host_player_id = v_new_host where id = p_room_id;
    end if;
    -- Otherwise the room is now empty; the next member to join becomes host.
  end if;
end;
$$;

-- Liveness signal from a connected client. Refreshes last_seen_at and runs room
-- maintenance. Fails with not_member when the caller's seat is gone (left/expired).
create function public.heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then
    perform public.raise_app_error('not_member');
  end if;

  update public.room_players
     set last_seen_at = now()
   where room_id = p_room_id and player_id = v_uid and left_at is null;
  if not found then
    perform public.raise_app_error('not_member');
  end if;

  perform public.maintain_room(p_room_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- Postgres Changes for the lobby. Delivery respects the subscriber's RLS.
alter publication supabase_realtime add table public.rooms, public.room_players;

-- Private Realtime channels ("room:<uuid>") are restricted to active members,
-- for both Presence and Broadcast.
create function public.can_access_room_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_room_member(substring(p_topic from 6)::uuid)
    else false
  end;
$$;

create policy "room members receive room channel messages"
  on realtime.messages for select to authenticated
  using (public.can_access_room_topic((select realtime.topic())));

create policy "room members send room channel messages"
  on realtime.messages for insert to authenticated
  with check (public.can_access_room_topic((select realtime.topic())));

-- -----------------------------------------------------------------------------
-- Privileges (defence in depth on top of RLS)
-- -----------------------------------------------------------------------------
-- Clients never write tables directly, and anonymous (not signed-in) requests
-- cannot read anything.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;

-- Functions are private unless explicitly granted.
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

-- RLS policy helpers must be executable by the querying role.
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_round_member(uuid) to authenticated;
grant execute on function public.can_access_room_topic(text) to authenticated;

-- The client-facing API.
grant execute on function public.create_room(text, integer) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
