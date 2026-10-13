-- pgTAP tests for round results: visibility, server-side scoring, invalidation,
-- reveal timeline, cumulative totals and security.
-- Run with:  npx supabase test db

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-0000-0000-00000000aa01', 'authenticated', 'authenticated', true), -- Stoyan (host)
  ('00000000-0000-0000-0000-00000000bb02', 'authenticated', 'authenticated', true), -- Desi
  ('00000000-0000-0000-0000-00000000cc03', 'authenticated', 'authenticated', true), -- Kaloyan
  ('00000000-0000-0000-0000-00000000dd04', 'authenticated', 'authenticated', true), -- Dora (other room)
  ('00000000-0000-0000-0000-00000000ee05', 'authenticated', 'authenticated', true); -- Emil (other room)

create function pg_temp.act_as(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;

-- Cell state / points straight from the scoring function (as postgres).
create function pg_temp.cell(p_player text, p_category text) returns text language sql as $$
  select c.state || ':' || c.points
    from public.round_cells(current_setting('test.round')::uuid) c
   where c.player_id = p_player::uuid and c.category = p_category::public.answer_category;
$$;

-- Value from get_round_results for a player.
create function pg_temp.result(p_results jsonb, p_player text, p_key text) returns text language sql as $$
  select p ->> p_key from jsonb_array_elements(p_results -> 'players') p where p ->> 'player_id' = p_player;
$$;
grant execute on function pg_temp.result(jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Setup: room with three players, a started round in PLAYING
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
set local role authenticated;
select set_config('test.code', public.create_room('Стоян', 5), true);
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select public.join_room(current_setting('test.code'), 'Деси');
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
select public.join_room(current_setting('test.code'), 'Калоян');
set local role postgres;
select set_config('test.room', (select id::text from public.rooms where code = current_setting('test.code')), true);
-- Distinct join order: Stoyan, Desi, Kaloyan.
update public.room_players set joined_at = now() - interval '3 minutes'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000aa01';
update public.room_players set joined_at = now() - interval '2 minutes'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000bb02';
update public.room_players set joined_at = now() - interval '1 minute'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000cc03';

select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
set local role authenticated;
select public.start_game(current_setting('test.room')::uuid);
select public.set_round_ready(current_setting('test.room')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select public.set_round_ready(current_setting('test.room')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
select public.set_round_ready(current_setting('test.room')::uuid);
set local role postgres;
select set_config('test.round', (select current_round_id::text from public.rooms where id = current_setting('test.room')::uuid), true);
update public.rounds
   set countdown_at = countdown_at - interval '4 seconds',
       started_at = started_at - interval '4 seconds',
       ends_at = ends_at - interval '4 seconds'
 where id = current_setting('test.round')::uuid;
-- The letter is random; the fixture answers are written for "М".
update public.rounds set letter = 'М' where id = current_setting('test.round')::uuid;
update public.rooms set used_letters = array['М']
 where id = current_setting('test.room')::uuid and cardinality(used_letters) > 0;

-- Answers designed to cover every scoring rule.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
set local role authenticated;
select public.save_answers(current_setting('test.room')::uuid, current_setting('test.round')::uuid,
  '{"country":"Малта","city":"Монтана","animal":"Мечка","plant":"Мурсалски чай","name":"Мария"}'::jsonb);
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select public.save_answers(current_setting('test.room')::uuid, current_setting('test.round')::uuid,
  '{"country":"   ","city":" монтана ","animal":"Мечка","plant":"Мурсалски-чай","name":"мария","object":"Кристина"}'::jsonb);
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
select public.save_answers(current_setting('test.room')::uuid, current_setting('test.round')::uuid,
  '{"country":"Мексико","city":"МОНТАНА ","animal":"Мравка","object":" кристина"}'::jsonb);

-- 1–2. Nothing is visible before the reveal.
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select throws_ok(format($$ select public.get_round_results(%L) $$, current_setting('test.room')),
  'P0001', 'results_not_available', 'results are unavailable while playing');
select is((select count(*) from public.answers where player_id <> '00000000-0000-0000-0000-00000000bb02'),
  0::bigint, 'other players'' answers are unreadable while playing');

-- Everyone locks → RESULTS_READY: still hidden, host included.
select public.lock_answers(current_setting('test.room')::uuid, current_setting('test.round')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
select public.lock_answers(current_setting('test.room')::uuid, current_setting('test.round')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select public.lock_answers(current_setting('test.room')::uuid, current_setting('test.round')::uuid);
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room')::uuid),
  'RESULTS_READY', 'round locked');
set local role authenticated;
select throws_ok(format($$ select public.get_round_results(%L) $$, current_setting('test.room')),
  'P0001', 'results_not_available', 'the host cannot read results before the reveal');
select is((select count(*) from public.answers where player_id <> '00000000-0000-0000-0000-00000000aa01'),
  0::bigint, 'the host cannot read answers before the reveal');
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000bb02', 'animal', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'results_not_available', 'nothing can be invalidated before the reveal');

-- 21. Final results-ready → exactly one reveal timeline.
select public.set_results_ready(current_setting('test.room')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select public.set_results_ready(current_setting('test.room')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
select public.set_results_ready(current_setting('test.room')::uuid);
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room')::uuid), 'REVEAL', 'ready starts the reveal');
select is((select phase::text from public.rooms where id = current_setting('test.room')::uuid),
  'REVEAL', 'everyone ready → REVEAL');
select ok((select reveal_at >= now() from public.rounds where id = current_setting('test.round')::uuid),
  'reveal_at is fixed by the trusted worker');
select set_config('test.reveal_at', (select reveal_at::text from public.rounds where id = current_setting('test.round')::uuid), true);
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
set local role authenticated;
select lives_ok(format($$ select public.set_results_ready(%L) $$, current_setting('test.room')), 'a late retry is harmless');
set local role postgres;
select is((select reveal_at::text from public.rounds where id = current_setting('test.round')::uuid),
  current_setting('test.reveal_at'), 'a retry never moves the reveal timeline');

-- 3. Answers and results are visible from REVEAL.
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
set local role authenticated;
select is((select count(distinct player_id) from public.answers where round_id = current_setting('test.round')::uuid),
  3::bigint, 'answers of all participants become readable at REVEAL');
select set_config('test.results', public.get_round_results(current_setting('test.room')::uuid)::text, true);
select is(current_setting('test.results')::jsonb ->> 'phase', 'REVEAL', 'results report the phase');
select is((current_setting('test.results')::jsonb #>> '{round,reveal_at}')::timestamptz::text,
  current_setting('test.reveal_at'), '22. a refresh during the reveal gets the same reveal_at');
select is(jsonb_array_length(current_setting('test.results')::jsonb -> 'players'), 3, 'one row per participant');
select is((select jsonb_agg(p ->> 'display_name') from jsonb_array_elements(current_setting('test.results')::jsonb -> 'players') p),
  '["Стоян","Деси","Калоян"]'::jsonb, 'rows follow the stable participant (join) order');
select is((select jsonb_agg(c ->> 'category')
             from jsonb_array_elements(current_setting('test.results')::jsonb #> '{players,0,cells}') c),
  '["country","city","village","animal","plant","object","name"]'::jsonb, 'cells follow the category order');

-- 4–7. Scoring.
set local role postgres;
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'country'), 'unique:1', 'unique answer = 1');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000bb02', 'country'), 'empty:0', 'whitespace-only answer is empty = 0');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'village'), 'empty:0', 'missing answer is empty = 0');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'city'), 'duplicate:0', '3-way duplicate (case/space-insensitive) = 0 …');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000bb02', 'city'), 'duplicate:0', '… for the second member …');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000cc03', 'city'), 'duplicate:0', '… and for the third member');
select is((select duplicate_count from public.round_cells(current_setting('test.round')::uuid)
            where player_id = '00000000-0000-0000-0000-00000000cc03' and category = 'city'),
  3, 'the duplicate group size is reported');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'animal'), 'duplicate:0', '2-way duplicate = 0');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000cc03', 'animal'), 'unique:1', 'a different answer in the same category stays unique');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'plant'), 'unique:1', '"Мурсалски чай" …');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000bb02', 'plant'), 'unique:1', '… and "Мурсалски-чай" are not merged');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'name'), 'duplicate:0', 'duplicates are case-insensitive');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000bb02', 'object'), 'wrong_letter:0',
  'an answer that does not start with the round letter scores 0 automatically');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000cc03', 'object'), 'wrong_letter:0',
  'two equal wrong-letter answers are wrong_letter, not duplicates');
select is((select duplicate_count from public.round_cells(current_setting('test.round')::uuid)
            where player_id = '00000000-0000-0000-0000-00000000cc03' and category = 'object'),
  0, 'wrong-letter answers are left out of duplicate groups');
select is((select raw_value from public.answers where category = 'city' and player_id = '00000000-0000-0000-0000-00000000bb02'),
  'монтана', 'the original text is kept for display');

set local role authenticated;
select is(pg_temp.result(current_setting('test.results')::jsonb, '00000000-0000-0000-0000-00000000aa01', 'round_points'),
  '2', 'Stoyan round score');
select is(pg_temp.result(current_setting('test.results')::jsonb, '00000000-0000-0000-0000-00000000bb02', 'round_points'),
  '1', 'Desi round score');
select is(pg_temp.result(current_setting('test.results')::jsonb, '00000000-0000-0000-0000-00000000cc03', 'round_points'),
  '2', 'Kaloyan round score');
select is(pg_temp.result(current_setting('test.results')::jsonb, '00000000-0000-0000-0000-00000000aa01', 'total_points'),
  '2', 'cumulative = round 1 score in round 1');

-- ---------------------------------------------------------------------------
-- Invalidation
-- ---------------------------------------------------------------------------
-- 10. Non-host cannot invalidate.
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000aa01', 'animal', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'not_host', 'a non-host cannot invalidate');

-- 11 + 8. Host invalidates Desi's "Мечка" → Stoyan's "Мечка" becomes unique.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select lives_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000bb02', 'animal', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'the host invalidates an answer');
set local role postgres;
select is(pg_temp.cell('00000000-0000-0000-0000-00000000bb02', 'animal'), 'invalid:0', 'the invalidated answer scores 0');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'animal'), 'unique:1',
  'the remaining duplicate member becomes unique');
select is((select invalidated_by from public.answers where category = 'animal' and player_id = '00000000-0000-0000-0000-00000000bb02'),
  '00000000-0000-0000-0000-00000000aa01'::uuid, 'who invalidated is recorded');
select is((select count(*) from public.answer_invalidation_events where round_id = current_setting('test.round')::uuid),
  1::bigint, 'an audit event is written');
select is((select results_revision from public.rooms where id = current_setting('test.room')::uuid),
  1, 'the room results revision is bumped for realtime');

select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
set local role authenticated;
select set_config('test.results2', public.get_round_results(current_setting('test.room')::uuid)::text, true);
select is(pg_temp.result(current_setting('test.results2')::jsonb, '00000000-0000-0000-0000-00000000aa01', 'round_points'),
  '3', 'Stoyan gains a point after the invalidation');
select is(pg_temp.result(current_setting('test.results2')::jsonb, '00000000-0000-0000-0000-00000000aa01', 'total_points'),
  '3', 'and the cumulative total follows');

-- 19. Repeated invalidation is idempotent.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select lives_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000bb02', 'animal', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'invalidating again is accepted');
set local role postgres;
select is((select count(*) from public.answer_invalidation_events where round_id = current_setting('test.round')::uuid),
  1::bigint, 'a repeated invalidation changes nothing');

-- 9 + 20. Restore recreates the duplicate; repeated restore is idempotent.
set local role authenticated;
select lives_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000bb02', 'animal', false) $$,
         current_setting('test.room'), current_setting('test.round')),
  'the host restores the answer');
select lives_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000bb02', 'animal', false) $$,
         current_setting('test.room'), current_setting('test.round')),
  'restoring again is accepted');
set local role postgres;
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'animal'), 'duplicate:0', 'restoring recreates the duplicate …');
select is(pg_temp.cell('00000000-0000-0000-0000-00000000bb02', 'animal'), 'duplicate:0', '… for both members');
select is((select count(*) from public.answer_invalidation_events where round_id = current_setting('test.round')::uuid),
  2::bigint, 'one restore event, the repeat is a no-op');

-- Invalidating one member of a 3-way group keeps the other two duplicated.
set local role authenticated;
select public.set_answer_invalidated(current_setting('test.room')::uuid, current_setting('test.round')::uuid,
  '00000000-0000-0000-0000-00000000cc03', 'city', true);
set local role postgres;
select is(pg_temp.cell('00000000-0000-0000-0000-00000000aa01', 'city'), 'duplicate:0',
  'two remaining members of a 3-way group are still duplicates');

-- 14. Empty / nonexistent targets.
set local role authenticated;
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000bb02', 'country', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'answer_empty', 'an empty answer cannot be invalidated');
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000aa01', 'village', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'answer_empty', 'a missing answer cannot be invalidated');
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000aa01', 'capital', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'invalid_category', 'an unknown category is rejected');

-- 13. Wrong round / wrong room.
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, gen_random_uuid(), '00000000-0000-0000-0000-00000000aa01', 'city', true) $$,
         current_setting('test.room')),
  'P0001', 'round_not_active', 'a round that is not the room''s current round is rejected');

select pg_temp.act_as('00000000-0000-0000-0000-00000000dd04');
select set_config('test.code2', public.create_room('Дора', 2), true);
set local role postgres;
select set_config('test.room2', (select id::text from public.rooms where code = current_setting('test.code2')), true);
set local role authenticated;
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000aa01', 'city', true) $$,
         current_setting('test.room2'), current_setting('test.round')),
  'P0001', 'round_not_active', 'another room''s host cannot touch this round');

-- 15–16. No direct writes; no edits during results.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select throws_ok($$ update public.answers set invalidated_at = now() $$, '42501', null,
  'invalidation state cannot be written directly');
select throws_ok($$ select * from public.answer_invalidation_events $$, '42501', null,
  'the audit trail is not readable by clients');
select throws_ok(
  format($$ insert into public.answer_invalidation_events (room_id, round_id, player_id, category, action)
            values (%L, %L, '00000000-0000-0000-0000-00000000aa01', 'city', 'restore') $$,
         current_setting('test.room'), current_setting('test.round')),
  '42501', null, 'the audit trail cannot be written by clients');
select throws_ok(
  format($$ select public.save_answers(%L, %L, '{"village":"Мездра"}'::jsonb) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'answers_locked', 'answers cannot be edited during the results');

-- Effective REVEAL → RESULTS after the reveal duration (server time).
set local role postgres;
update public.rounds set reveal_at = reveal_at - interval '12 seconds' where id = current_setting('test.round')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
set local role authenticated;
select public.heartbeat(current_setting('test.room')::uuid);
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room')::uuid),
  'RESULTS', 'the room moves to RESULTS once the reveal has played out');

-- 12. Host migration moves invalidation authority immediately.
update public.room_players set last_seen_at = now() - interval '60 seconds'
 where room_id = current_setting('test.room')::uuid and player_id = '00000000-0000-0000-0000-00000000aa01';
set local role authenticated;
select public.heartbeat(current_setting('test.room')::uuid);
set local role postgres;
select is((select host_player_id from public.rooms where id = current_setting('test.room')::uuid),
  '00000000-0000-0000-0000-00000000bb02'::uuid, 'host migrated to Desi');
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
set local role authenticated;
select throws_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000cc03', 'country', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'P0001', 'not_host', 'the former host loses invalidation rights');
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select lives_ok(
  format($$ select public.set_answer_invalidated(%L, %L, '00000000-0000-0000-0000-00000000cc03', 'country', true) $$,
         current_setting('test.room'), current_setting('test.round')),
  'the new host can invalidate during RESULTS');
set local role postgres;
select is((select phase::text from public.rooms where id = current_setting('test.room')::uuid),
  'RESULTS', 'host migration does not reset the results');

-- 23. A participant who leaves stays in the results.
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
set local role authenticated;
select public.leave_room(current_setting('test.room')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select set_config('test.results3', public.get_round_results(current_setting('test.room')::uuid)::text, true);
select is(jsonb_array_length(current_setting('test.results3')::jsonb -> 'players'), 3,
  'a player who left keeps their results row');
select is(pg_temp.result(current_setting('test.results3')::jsonb, '00000000-0000-0000-0000-00000000cc03', 'left'),
  'true', 'and is marked as having left');

-- 17. Cumulative totals sum every revealed round (simulate a finished round 2).
set local role postgres;
insert into public.rounds (id, room_id, round_number, letter, countdown_at, started_at, ends_at, locked_at, lock_reason, reveal_at)
select '00000000-0000-0000-0000-0000000000f2', current_setting('test.room')::uuid, 2, l,
       now() - interval '1 minute', now() - interval '1 minute', now() + interval '1 minute',
       now(), 'all_ready', now() - interval '20 seconds'
  from unnest(public.eligible_letters()) as l
 where l <> (select letter from public.rounds where id = current_setting('test.round')::uuid)
 limit 1;
insert into public.answer_sheets (round_id, player_id, room_id, submitted_at, lock_reason)
values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aa01', current_setting('test.room')::uuid, now(), 'ready'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bb02', current_setting('test.room')::uuid, now(), 'ready');
insert into public.answers (round_id, player_id, category, raw_value, normalized_value)
values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aa01', 'country', 'Х1', 'х1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000aa01', 'city', 'Х2', 'х2'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bb02', 'city', 'Х2', 'х2');
update public.rooms set current_round_id = '00000000-0000-0000-0000-0000000000f2', phase = 'RESULTS'
 where id = current_setting('test.room')::uuid;

set local role authenticated;
select set_config('test.results4', public.get_round_results(current_setting('test.room')::uuid)::text, true);
select is(pg_temp.result(current_setting('test.results4')::jsonb, '00000000-0000-0000-0000-00000000aa01', 'round_points'),
  '1', 'round 2 score is computed for its own answers');
select is(pg_temp.result(current_setting('test.results4')::jsonb, '00000000-0000-0000-0000-00000000aa01', 'total_points'),
  '3', 'cumulative = round 1 (2) + round 2 (1)');
select is(
  pg_temp.result(public.get_round_results(current_setting('test.room')::uuid, current_setting('test.round')::uuid),
                 '00000000-0000-0000-0000-00000000aa01', 'round_points'),
  '2', 'historical round results stay queryable and unchanged');

select * from finish();
rollback;
