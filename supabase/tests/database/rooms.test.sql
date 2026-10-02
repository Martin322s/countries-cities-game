-- pgTAP tests for the room/lobby RPCs, RLS and privileges.
-- Run with:  npx supabase test db
--
-- Users are impersonated by switching to the `authenticated` role and setting
-- request.jwt.claims, exactly as PostgREST does for real requests.
-- Values shared between steps are kept in custom GUCs (test.*), readable by any role.

begin;
create extension if not exists pgtap with schema extensions;

select plan(55);

-- ---------------------------------------------------------------------------
-- Fixtures: anonymous auth users
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', true), -- Stoyan
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', true), -- Desi
  ('00000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', true), -- Ivan
  ('00000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', true), -- Outsider
  ('00000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated', true); -- Mela

-- ---------------------------------------------------------------------------
-- Unauthenticated access
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.create_room('Стоян', 4) $$, '42501', null,
  'anon cannot call create_room');
select throws_ok($$ select * from public.rooms $$, '42501', null,
  'anon cannot read rooms');
select throws_ok($$ select * from public.room_players $$, '42501', null,
  'anon cannot read room_players');
set local role postgres;

-- ---------------------------------------------------------------------------
-- Stoyan creates a room (capacity 3)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$ select public.create_room('   ', 4) $$, 'P0001', 'invalid_display_name',
  'blank display name is rejected');
select throws_ok($$ select public.create_room(repeat('Я', 21), 4) $$, 'P0001', 'invalid_display_name',
  'display name over 20 characters is rejected');
select throws_ok($$ select public.create_room('Стоян', 1) $$, 'P0001', 'invalid_capacity',
  'capacity below 2 is rejected');
select throws_ok($$ select public.create_room('Стоян', 16) $$, 'P0001', 'invalid_capacity',
  'capacity above 15 is rejected');

select set_config('test.code', public.create_room('  Стоян  ', 3), true);
select matches(current_setting('test.code'), '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$',
  'create_room returns a canonical 5-character code');

set local role postgres;
select set_config('test.room', (select id::text from public.rooms where code = current_setting('test.code')), true);
select is((select host_player_id from public.rooms where id = current_setting('test.room')::uuid),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'creator is host');
select is((select display_name from public.room_players where room_id = current_setting('test.room')::uuid),
  'Стоян', 'display name is stored trimmed');
select is((select capacity from public.rooms where id = current_setting('test.room')::uuid),
  3::smallint, 'capacity is stored');

-- ---------------------------------------------------------------------------
-- Non-members cannot see the room
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.rooms), 0::bigint, 'non-member cannot read any room');
select is((select count(*) from public.rooms where code = current_setting('test.code')), 0::bigint,
  'non-member cannot look a room up by code');
select is((select count(*) from public.room_players), 0::bigint, 'non-member cannot read members');
select is(public.can_access_room_topic('room:' || current_setting('test.room')), false,
  'non-member cannot use the room realtime channel');

-- ---------------------------------------------------------------------------
-- Desi joins
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.join_room('AB', 'Деси') $$, 'P0001', 'invalid_room_code',
  'malformed code is rejected');
-- An unknown code joins nothing and returns NULL (not an exception), so the failed
-- lookup is counted against the caller's guessing budget (production hardening).
select is(public.join_room('ZZZZZ', 'Деси'), null, 'unknown code joins nothing (NULL)');
select is((select count(*) from public.room_players rp join public.rooms r on r.id = rp.room_id where r.code = 'ZZZZZ'), 0::bigint,
  'no room is created or joined for an unknown code');
select throws_ok(
  format($$ select public.join_room(%L, 'стоян') $$, current_setting('test.code')),
  'P0001', 'display_name_taken', 'duplicate display name is rejected case-insensitively');
select is(
  public.join_room(' ' || lower(left(current_setting('test.code'), 2)) || '-' || lower(substr(current_setting('test.code'), 3)), 'Деси'),
  current_setting('test.code'),
  'join normalizes the code and returns the canonical one');
select is((select count(*) from public.room_players where left_at is null), 2::bigint,
  'member can read the roster');
select is((select count(*) from public.rooms), 1::bigint, 'member can read their room');
select is(public.can_access_room_topic('room:' || current_setting('test.room')), true,
  'member can use the room realtime channel');
select is(public.can_access_room_topic('room:not-a-uuid'), false, 'malformed topic is denied');

-- Rejoin (refresh) never creates a second membership and keeps the original name.
select is(public.join_room(current_setting('test.code'), 'Друго име'), current_setting('test.code'),
  'rejoin succeeds');
select is((select count(*) from public.room_players), 2::bigint, 'rejoin does not duplicate membership');
select is(
  (select display_name from public.room_players where player_id = '00000000-0000-0000-0000-00000000000b'),
  'Деси', 'rejoin keeps the existing display name');

-- ---------------------------------------------------------------------------
-- Direct writes are impossible
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.rooms set host_player_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'member cannot make themselves host');
select throws_ok(
  $$ update public.room_players set display_name = 'Хакер' $$,
  '42501', null, 'member cannot edit player records');
select throws_ok(
  format($$ insert into public.room_players (room_id, player_id, display_name, display_name_key)
            values (%L, '00000000-0000-0000-0000-00000000000d', 'X', 'x') $$, current_setting('test.room')),
  '42501', null, 'member cannot insert memberships');
select throws_ok($$ delete from public.room_players $$, '42501', null, 'member cannot delete memberships');
select throws_ok(
  format($$ select public.maintain_room(%L) $$, current_setting('test.room')),
  '42501', null, 'internal maintenance function is not callable by clients');
select throws_ok($$ select public.generate_room_code() $$, '42501', null,
  'internal code generator is not callable by clients');

-- ---------------------------------------------------------------------------
-- Capacity (3): Ivan fills the last seat, the next player is rejected
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select lives_ok(format($$ select public.join_room(%L, 'Иван') $$, current_setting('test.code')),
  'third player takes the last seat');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select throws_ok(format($$ select public.join_room(%L, 'Ралица') $$, current_setting('test.code')),
  'P0001', 'room_full', 'join beyond capacity is rejected');

-- Outsider cannot heartbeat or leave a room they are not in
select throws_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room')),
  'P0001', 'not_member', 'non-member heartbeat is rejected');
select throws_ok(format($$ select public.leave_room(%L) $$, current_setting('test.room')),
  'P0001', 'not_member', 'non-member leave is rejected');

-- ---------------------------------------------------------------------------
-- Host leaves → deterministic, atomic migration to the earliest joined member
-- ---------------------------------------------------------------------------
set local role postgres;
-- Distinct join times (inside one transaction now() is constant).
update public.room_players set joined_at = now() - interval '3 minutes'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000a';
update public.room_players set joined_at = now() - interval '2 minutes'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000b';
update public.room_players set joined_at = now() - interval '1 minute'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000c';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format($$ select public.leave_room(%L) $$, current_setting('test.room')), 'host can leave');
select is((select count(*) from public.rooms), 0::bigint, 'a player who left can no longer read the room');

set local role postgres;
select is((select host_player_id from public.rooms where id = current_setting('test.room')::uuid),
  '00000000-0000-0000-0000-00000000000b'::uuid, 'earliest-joined remaining member becomes host');
select is((select left_reason::text from public.room_players
            where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000a'),
  'left', 'leave is recorded as intentional');

-- Stoyan rejoins: same row, fresh join time, not host any more.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format($$ select public.join_room(%L, 'Стоян') $$, current_setting('test.code')),
  'a member who left can rejoin while seats are free');
set local role postgres;
select is((select count(*) from public.room_players
            where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000a'),
  1::bigint, 'rejoin after leaving reuses the same membership row');
select is((select host_player_id from public.rooms where id = current_setting('test.room')::uuid),
  '00000000-0000-0000-0000-00000000000b'::uuid, 'rejoining does not reclaim host');

-- ---------------------------------------------------------------------------
-- Stale host: kept during the grace period, migrated afterwards
-- ---------------------------------------------------------------------------
update public.room_players set last_seen_at = now() - interval '30 seconds'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000b';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room')), 'member heartbeat succeeds');
set local role postgres;
select is((select host_player_id from public.rooms where id = current_setting('test.room')::uuid),
  '00000000-0000-0000-0000-00000000000b'::uuid, 'briefly disconnected host keeps the role');

update public.room_players set last_seen_at = now() - interval '60 seconds'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000b';
set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room')), 'heartbeat runs maintenance');
set local role postgres;
-- Ivan joined before Stoyan's rejoin, so Ivan is the earliest connected member.
select is((select host_player_id from public.rooms where id = current_setting('test.room')::uuid),
  '00000000-0000-0000-0000-00000000000c'::uuid, 'stale host is replaced by the earliest connected member');
select is((select left_at is null from public.room_players
            where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000b'),
  true, 'a stale member keeps their seat before lobby expiry');

-- ---------------------------------------------------------------------------
-- Lobby seat expiry
-- ---------------------------------------------------------------------------
update public.room_players set last_seen_at = now() - interval '3 minutes'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000b';
set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room')), 'heartbeat after expiry window');
set local role postgres;
select is((select left_reason::text from public.room_players
            where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000000b'),
  'expired', 'member silent past the lobby expiry loses their seat');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room')),
  'P0001', 'not_member', 'an expired member is told their seat is gone');

-- ---------------------------------------------------------------------------
-- Joinability by phase
-- ---------------------------------------------------------------------------
set local role postgres;
update public.rooms set phase = 'PLAYING' where id = current_setting('test.room')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format($$ select public.join_room(%L, 'Мела') $$, current_setting('test.code')),
  'P0001', 'game_in_progress', 'new players cannot join a game in progress');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select lives_ok(format($$ select public.join_room(%L, 'Иван') $$, current_setting('test.code')),
  'an active member can still rejoin during a game');

set local role postgres;
update public.rooms set phase = 'FINISHED' where id = current_setting('test.room')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format($$ select public.join_room(%L, 'Мела') $$, current_setting('test.code')),
  'P0001', 'room_finished', 'nobody new can join a finished room');

select * from finish();
rollback;
