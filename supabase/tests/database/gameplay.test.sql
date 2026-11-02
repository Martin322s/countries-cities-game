-- pgTAP tests for core round gameplay: start, ready stages, letter draw, timing,
-- answer privacy and locking, timeout, early completion, leaving and host migration.
-- Run with:  npx supabase test db
--
-- Inside one transaction now() is constant, so the passage of time is simulated by
-- shifting round timestamps / heartbeats into the past as the postgres role.

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();
\ir ../helpers/ai_validation.sql

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', true), -- Stoyan
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', true), -- Desi
  ('00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', true), -- Kaloyan
  ('00000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', true), -- Dora
  ('00000000-0000-0000-0000-0000000000e5', 'authenticated', 'authenticated', true), -- Emil
  ('00000000-0000-0000-0000-0000000000f6', 'authenticated', 'authenticated', true); -- Fani

-- Helper: act as a user (role + JWT claims, like PostgREST does).
create function pg_temp.act_as(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;

-- ===========================================================================
-- Room 1: Stoyan (host), Desi, Kaloyan
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('test.code1', public.create_room('Стоян', 4), true);
set local role postgres;
select set_config('test.room1', (select id::text from public.rooms where code = current_setting('test.code1')), true);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select lives_ok(format($$ select public.join_room(%L, 'Деси') $$, current_setting('test.code1')), 'Desi joins');

-- 1. Non-host cannot start.
select throws_ok(format($$ select public.start_game(%L) $$, current_setting('test.room1')),
  'P0001', 'not_host', 'a non-host cannot start the game');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select lives_ok(format($$ select public.join_room(%L, 'Калоян') $$, current_setting('test.code1')), 'Kaloyan joins');

-- Ready before the game exists is rejected.
select throws_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room1')),
  'P0001', 'not_participant', 'no ready check exists before the game starts');

-- Host starts.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ select public.start_game(%L) $$, current_setting('test.room1')), 'host starts the game');

set local role postgres;
select set_config('test.round1', (select current_round_id::text from public.rooms where id = current_setting('test.room1')::uuid), true);
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'ROUND_WAITING', 'start moves the room to ROUND_WAITING');
select is((select round_number from public.rounds where id = current_setting('test.round1')::uuid),
  1::smallint, 'round 1 is created');
select is((select letter from public.rounds where id = current_setting('test.round1')::uuid),
  null, 'no letter is drawn at start');
select is((select started_at from public.rounds where id = current_setting('test.round1')::uuid),
  null, 'no timer is started at start');
select is((select count(*) from public.answer_sheets where round_id = current_setting('test.round1')::uuid),
  3::bigint, 'every active member becomes a round participant');

-- 3. Cannot start twice.
set local role authenticated;
select throws_ok(format($$ select public.start_game(%L) $$, current_setting('test.room1')),
  'P0001', 'game_already_started', 'the game cannot be started twice');
set local role postgres;
select is((select count(*) from public.rounds where room_id = current_setting('test.room1')::uuid),
  1::bigint, 'a second start does not create another round');

-- 4. New players cannot join after the game started.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6');
set local role authenticated;
select throws_ok(format($$ select public.join_room(%L, 'Фани') $$, current_setting('test.code1')),
  'P0001', 'game_in_progress', 'a brand-new player cannot join a started game');

-- ---------------------------------------------------------------------------
-- Pre-round ready
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room1')), 'Desi is ready');
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room1')), 'repeated ready is accepted');
set local role postgres;
select is((select count(*) from public.ready_checks where round_id = current_setting('test.round1')::uuid),
  1::bigint, 'ready is idempotent and only marks the caller');

-- 5. A client cannot mark someone else ready directly.
set local role authenticated;
select throws_ok(
  format($$ insert into public.ready_checks (round_id, player_id, stage, room_id)
            values (%L, '00000000-0000-0000-0000-0000000000c3', 'pre_round', %L) $$,
         current_setting('test.round1'), current_setting('test.room1')),
  '42501', null, 'players cannot write ready checks directly');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room1')), 'Stoyan is ready');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'ROUND_WAITING', 'the round does not start while someone is not ready');

-- Last participant ready → exactly one countdown with a letter.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
set local role authenticated;
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room1')), 'Kaloyan is ready');
set local role postgres;

select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'COUNTDOWN', 'everyone ready starts the countdown');
select is((select count(*) from public.rounds where room_id = current_setting('test.room1')::uuid),
  1::bigint, 'all-ready creates no extra rounds');
select ok((select letter = any (public.eligible_letters()) from public.rounds where id = current_setting('test.round1')::uuid),
  'the drawn letter is eligible (never Ъ or Ь)');
select is((select started_at - countdown_at from public.rounds where id = current_setting('test.round1')::uuid),
  interval '3 seconds', 'countdown lasts 3 seconds of server time');
select is((select ends_at - started_at from public.rounds where id = current_setting('test.round1')::uuid),
  interval '60 seconds', 'the round lasts 60 seconds of server time');
select is((select cardinality(used_letters) from public.rooms where id = current_setting('test.room1')::uuid),
  0, 'used_letters (broadcast over realtime) stays empty during the countdown');

-- Letter privacy during the countdown.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$ select letter from public.rounds where id = %L $$, current_setting('test.round1')),
  '42501', null, 'clients cannot read rounds.letter directly');
select is((public.get_game_state(current_setting('test.room1')::uuid) #>> '{round,letter}'), null,
  'get_game_state hides the letter until the start time');
-- 10. The client cannot choose or change the letter.
select throws_ok(format($$ update public.rounds set letter = 'А' where id = %L $$, current_setting('test.round1')),
  '42501', null, 'clients cannot set the letter');
select throws_ok(
  format($$ select public.save_answers(%L, %L, '{"country":"Албания"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'P0001', 'wrong_phase', 'answers cannot be saved during the countdown');

-- ---------------------------------------------------------------------------
-- PLAYING (simulate the countdown having elapsed)
-- ---------------------------------------------------------------------------
set local role postgres;
update public.rounds
   set countdown_at = countdown_at - interval '4 seconds',
       started_at = started_at - interval '4 seconds',
       ends_at = ends_at - interval '4 seconds'
 where id = current_setting('test.round1')::uuid;
select set_config('test.letter1', (select letter from public.rounds where id = current_setting('test.round1')::uuid), true);

set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room1')), 'a heartbeat advances the timed phase');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'PLAYING', 'COUNTDOWN becomes PLAYING once started_at has passed');
select is((select used_letters from public.rooms where id = current_setting('test.room1')::uuid),
  array[current_setting('test.letter1')], 'the revealed letter is recorded as used');
set local role authenticated;
select is((public.get_game_state(current_setting('test.room1')::uuid) #>> '{round,letter}'),
  current_setting('test.letter1'), 'get_game_state reveals the letter after the start time');

-- 11. Players write their own answers.
select lives_ok(
  format($$ select public.save_answers(%L, %L, '{"country":"  Белгия ","city":"Бургас"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'Desi saves her own answers');
select is((select raw_value from public.answers where category = 'country' and player_id = '00000000-0000-0000-0000-0000000000b2'),
  'Белгия', 'answers are stored trimmed with casing preserved');
select is((select normalized_value from public.answers where category = 'country' and player_id = '00000000-0000-0000-0000-0000000000b2'),
  'белгия', 'the server stores the normalized duplicate key');
select lives_ok(
  format($$ select public.save_answers(%L, %L, '{"country":"Беларус"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'a later save overwrites the answer');
select is((select count(*) from public.answers where player_id = '00000000-0000-0000-0000-0000000000b2'),
  2::bigint, 'saves upsert per category');
select throws_ok(
  format($$ select public.save_answers(%L, %L, '{"capital":"x"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'P0001', 'invalid_category', 'unknown categories are rejected');
select throws_ok(
  format($$ select public.save_answers(%L, %L, jsonb_build_object('plant', repeat('я', 101))) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'P0001', 'answer_too_long', 'answers over 100 characters are rejected');
select throws_ok(
  format($$ select public.save_answers(%L, %L, '["x"]'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'P0001', 'invalid_answers', 'non-object payloads are rejected');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  format($$ select public.save_answers(%L, %L, '{"country":"Белгия","animal":"Бобър"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'Stoyan saves his answers');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select lives_ok(
  format($$ select public.save_answers(%L, %L, '{"name":"Борис"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'Kaloyan saves her answers');

-- 12–14. Answer privacy during PLAYING.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.answers), 2::bigint, 'a player sees only their own answers');
select is((select count(*) from public.answers where player_id = '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'a player cannot read another player''s answers while playing');
select throws_ok(
  format($$ insert into public.answers (round_id, player_id, category, raw_value)
            values (%L, '00000000-0000-0000-0000-0000000000a1', 'plant', 'Бор') $$, current_setting('test.round1')),
  '42501', null, 'a player cannot write another player''s answers');
select throws_ok($$ update public.answers set raw_value = 'x' $$, '42501', null, 'answers cannot be updated directly');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.answers where player_id <> '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'the host cannot read other players'' answers while playing');

-- 15. Personal ready locks answers.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok(format($$ select public.report_visibility(%L, %L, false) $$, current_setting('test.room1'), current_setting('test.round1')),
  'Desi locks her answers');
select lives_ok(format($$ select public.report_visibility(%L, %L, false) $$, current_setting('test.room1'), current_setting('test.round1')),
  'locking again is idempotent');
select throws_ok(
  format($$ select public.save_answers(%L, %L, '{"plant":"Бор"}'::jsonb) $$,
         current_setting('test.room1'), current_setting('test.round1')),
  'P0001', 'answers_locked', 'answers cannot change after personal ready');
select is((select raw_value from public.answers where category = 'country' and player_id = '00000000-0000-0000-0000-0000000000b2'),
  'Беларус', 'locked answers are preserved (refresh restores them)');
select is((public.get_game_state(current_setting('test.room1')::uuid) #> '{participants}')
            @> '[{"player_id":"00000000-0000-0000-0000-0000000000b2","answers_lock_reason":"tab_exit"}]'::jsonb,
  true, 'the lock is visible in the game state (survives refresh)');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'PLAYING', 'one tab lock leaves others answering');

-- 22. Lobby seat expiry never removes a game participant.
update public.room_players set last_seen_at = now() - interval '10 minutes'
 where room_id = current_setting('test.room1')::uuid and player_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room1')), 'heartbeat during the game');
set local role postgres;
select is((select left_at from public.room_players
            where room_id = current_setting('test.room1')::uuid and player_id = '00000000-0000-0000-0000-0000000000c3'),
  null, 'a silent participant is not expired during a game');
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'PLAYING', 'disconnected participant retains their answering time');

-- 23. Leaving during the round keeps the participant and their answers.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
set local role authenticated;
select lives_ok(format($$ select public.leave_room(%L) $$, current_setting('test.room1')), 'Kaloyan leaves mid-round');
set local role postgres;
select is((select lock_reason::text from public.answer_sheets
            where round_id = current_setting('test.round1')::uuid and player_id = '00000000-0000-0000-0000-0000000000c3'),
  'left', 'leaving mid-round locks the sheet as left');
select is((select raw_value from public.answers
            where round_id = current_setting('test.round1')::uuid and player_id = '00000000-0000-0000-0000-0000000000c3'),
  'Борис', 'answers of a player who left are kept');
select is((select count(*) from public.answer_sheets where round_id = current_setting('test.round1')::uuid),
  3::bigint, 'the participant snapshot is unchanged');

-- 18. Last remaining player locks → round ends early, exactly once.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok(format($$ select public.lock_answers(%L, %L) $$, current_setting('test.room1'), current_setting('test.round1')),
  'Stoyan locks the last sheet');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'RESULTS_READY', 'all locked ends the round early');
select is((select lock_reason::text from public.rounds where id = current_setting('test.round1')::uuid),
  'stop', 'the round records why it ended');

-- Answers stay private before the reveal.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*) from public.answers where player_id = '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'answers remain private in RESULTS_READY');

-- 24–25. Results-ready is a separate stage and completes exactly once.
set local role postgres;
select is(public.all_required_ready(current_setting('test.round1')::uuid, 'pre_results'), false,
  'pre-round readiness does not count toward the results stage');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select lives_ok(format($$ select public.set_results_ready(%L) $$, current_setting('test.room1')), 'Desi is ready for results');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'RESULTS_READY', 'waits for the remaining player (Kaloyan left, so she is not required)');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok(format($$ select public.set_results_ready(%L) $$, current_setting('test.room1')), 'Stoyan is ready for results');
select lives_ok(format($$ select public.set_results_ready(%L) $$, current_setting('test.room1')), 'a late retry succeeds silently');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'AI_VALIDATING', 'everyone ready starts AI validation');
select pg_temp.finish_validation(current_setting('test.room1')::uuid);
select is((select phase::text from public.rooms where id = current_setting('test.room1')::uuid),
  'REVEAL', 'trusted validation completes before reveal');
select is((select count(*) from public.ready_checks where round_id = current_setting('test.round1')::uuid and stage = 'pre_results'),
  2::bigint, 'one results-ready row per confirming participant');

-- Answers become visible to the room in the reveal.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*) from public.answers where player_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint, 'answers are revealed to members in REVEAL');

-- A participant who left may come back to the running game as themselves.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select lives_ok(format($$ select public.join_room(%L, 'Друго име') $$, current_setting('test.code1')),
  'a participant who left can rejoin the game');
set local role postgres;
select is((select display_name from public.room_players
            where room_id = current_setting('test.room1')::uuid and player_id = '00000000-0000-0000-0000-0000000000c3'),
  'Калоян', 'rejoining keeps the original identity and name');

-- ===========================================================================
-- Room 2: Dora (host), Emil — minimum players, staleness, host migration, timeout
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
set local role authenticated;
select set_config('test.code2', public.create_room('Дора', 2), true);
set local role postgres;
select set_config('test.room2', (select id::text from public.rooms where code = current_setting('test.code2')), true);

-- 2. Fewer than 2 players.
set local role authenticated;
select throws_ok(format($$ select public.start_game(%L) $$, current_setting('test.room2')),
  'P0001', 'not_enough_players', 'the host cannot start alone');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e5');
select lives_ok(format($$ select public.join_room(%L, 'Емил') $$, current_setting('test.code2')), 'Emil joins');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select lives_ok(format($$ select public.start_game(%L) $$, current_setting('test.room2')), 'Dora starts');
set local role postgres;
select set_config('test.round2', (select current_round_id::text from public.rooms where id = current_setting('test.room2')::uuid), true);

-- A brief disconnect (< 45 s) never lets the round start without the player.
update public.room_players set last_seen_at = now() - interval '30 seconds'
 where room_id = current_setting('test.room2')::uuid and player_id = '00000000-0000-0000-0000-0000000000e5';
set local role authenticated;
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room2')), 'Dora is ready');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room2')::uuid),
  'ROUND_WAITING', 'a briefly disconnected player is still waited for');

-- A player gone past the grace period no longer blocks the ready check.
update public.room_players set last_seen_at = now() - interval '60 seconds'
 where room_id = current_setting('test.room2')::uuid and player_id = '00000000-0000-0000-0000-0000000000e5';
set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room2')), 'heartbeat re-evaluates readiness');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room2')::uuid),
  'COUNTDOWN', 'a long-disconnected player does not block the round forever');

-- Host migration during a game keeps the round intact.
update public.rounds
   set countdown_at = countdown_at - interval '5 seconds',
       started_at = started_at - interval '5 seconds',
       ends_at = ends_at - interval '5 seconds'
 where id = current_setting('test.round2')::uuid;
select set_config('test.ends2', (select ends_at::text from public.rounds where id = current_setting('test.round2')::uuid), true);
update public.room_players set last_seen_at = now() - interval '60 seconds'
 where room_id = current_setting('test.room2')::uuid and player_id = '00000000-0000-0000-0000-0000000000d4';
update public.room_players set last_seen_at = now()
 where room_id = current_setting('test.room2')::uuid and player_id = '00000000-0000-0000-0000-0000000000e5';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e5');
set local role authenticated;
select lives_ok(format($$ select public.heartbeat(%L) $$, current_setting('test.room2')), 'Emil heartbeats');
set local role postgres;
select is((select host_player_id from public.rooms where id = current_setting('test.room2')::uuid),
  '00000000-0000-0000-0000-0000000000e5'::uuid, 'a stale host is replaced during the game');
select is((select ends_at::text from public.rounds where id = current_setting('test.round2')::uuid),
  current_setting('test.ends2'), 'host migration does not touch the round timer');
select is((select phase::text from public.rooms where id = current_setting('test.room2')::uuid),
  'PLAYING', 'host migration does not reset the phase');

-- 16/19. Timer expiration locks the round.
update public.rounds
   set countdown_at = countdown_at - interval '200 seconds',
       started_at = started_at - interval '200 seconds',
       ends_at = ends_at - interval '200 seconds'
 where id = current_setting('test.round2')::uuid;
set local role authenticated;
select throws_ok(
  format($$ select public.save_answers(%L, %L, '{"city":"Добрич"}'::jsonb) $$,
         current_setting('test.room2'), current_setting('test.round2')),
  'P0001', 'round_over', 'answers cannot change after the deadline, even before the phase update');
select lives_ok(format($$ select public.lock_answers(%L, %L) $$, current_setting('test.room2'), current_setting('test.round2')),
  'pressing ready after the deadline is a harmless no-op');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room2')::uuid),
  'RESULTS_READY', 'the next request after the deadline locks the round');
select is((select lock_reason::text from public.rounds where id = current_setting('test.round2')::uuid),
  'timeout', 'the round records a timeout');
select ok((select locked_at = ends_at from public.rounds where id = current_setting('test.round2')::uuid),
  'a timed-out round is locked at its authoritative deadline');

-- ===========================================================================
-- Room 3: letter exclusion across rounds (27 letters already used)
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6');
set local role authenticated;
select set_config('test.code3', public.create_room('Фани', 2), true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok(format($$ select public.join_room(%L, 'Деси') $$, current_setting('test.code3')), 'Desi joins room 3');
set local role postgres;
select set_config('test.room3', (select id::text from public.rooms where code = current_setting('test.code3')), true);

-- Pretend 27 earlier rounds already used every letter except 'М'.
insert into public.rounds (room_id, round_number, letter, countdown_at, started_at, ends_at, locked_at, lock_reason)
select current_setting('test.room3')::uuid, row_number() over (), l,
       now() - interval '1 hour', now() - interval '1 hour', now() - interval '58 minutes',
       now() - interval '58 minutes', 'timeout'
  from unnest(public.eligible_letters()) as l
 where l <> 'М';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6');
set local role authenticated;
select lives_ok(format($$ select public.start_game(%L) $$, current_setting('test.room3')), 'room 3 starts');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room3')), 'Desi ready in room 3');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6');
select lives_ok(format($$ select public.set_round_ready(%L) $$, current_setting('test.room3')), 'Fani ready in room 3');
set local role postgres;
select is((select letter from public.rounds r join public.rooms rm on rm.current_round_id = r.id
            where rm.id = current_setting('test.room3')::uuid),
  'М', 'previously used letters can never be drawn again');

select * from finish();
rollback;
