-- pgTAP tests for the full 28-round game loop and finalization.
-- Run with:  npx supabase test db
--
-- Rounds are played through the real RPCs while impersonating players; only the
-- passage of time is simulated (as postgres) by shifting round timestamps.

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', true), -- Stoyan
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', true), -- Desi
  ('00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', true), -- Kaloyan
  ('00000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', true); -- Dora (new)

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------
create function pg_temp.as_user(p_sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
grant execute on function pg_temp.as_admin() to authenticated;

create function pg_temp.room() returns uuid language sql as $$
  select current_setting('test.room')::uuid;
$$;
create function pg_temp.current_round() returns uuid language sql as $$
  select current_round_id from public.rooms where id = pg_temp.room();
$$;
create function pg_temp.phase() returns text language sql as $$
  select phase::text from public.rooms where id = pg_temp.room();
$$;

-- From ROUND_WAITING to REVEAL: everyone ready, countdown skipped, answers saved,
-- everyone locks, everyone ready for results. Returns the round id.
-- Letters are random, so every non-empty answer is prefixed with the round's letter:
-- equal answers stay equal and the scoring the fixtures describe is unchanged.
create function pg_temp.play_to_reveal(p_answers jsonb) returns uuid language plpgsql as $
declare
  v_round uuid := pg_temp.current_round();
  v_player uuid;
  v_entry record;
  v_letter text;
  v_answers jsonb;
begin
  for v_player in select player_id from public.answer_sheets where round_id = v_round loop
    perform pg_temp.as_user(v_player::text);
    perform public.set_round_ready(pg_temp.room());
    perform pg_temp.as_admin();
  end loop;
  update public.rounds
     set countdown_at = countdown_at - interval '4 seconds',
         started_at = started_at - interval '4 seconds',
         ends_at = ends_at - interval '4 seconds'
   where id = v_round;
  select letter into strict v_letter from public.rounds where id = v_round;
  for v_entry in select key, value from jsonb_each(p_answers) loop
    select coalesce(jsonb_object_agg(a.key, case when btrim(a.value #>> '{}') = '' then a.value
                                                 else to_jsonb(v_letter || btrim(a.value #>> '{}')) end), '{}')
      into v_answers
      from jsonb_each(v_entry.value) a;
    perform pg_temp.as_user(v_entry.key);
    perform public.save_answers(pg_temp.room(), v_round, v_answers);
    perform pg_temp.as_admin();
  end loop;
  for v_player in select player_id from public.answer_sheets where round_id = v_round loop
    perform pg_temp.as_user(v_player::text);
    perform public.lock_answers(pg_temp.room(), v_round);
    perform pg_temp.as_admin();
  end loop;
  for v_player in select player_id from public.answer_sheets where round_id = v_round loop
    perform pg_temp.as_user(v_player::text);
    perform public.set_results_ready(pg_temp.room());
    perform pg_temp.as_admin();
  end loop;
  return v_round;
end;
$$;

-- REVEAL → RESULTS (skip the 11 s reveal, then let a heartbeat apply it).
create function pg_temp.finish_reveal(p_as text) returns void language plpgsql as $$
begin
  update public.rounds set reveal_at = reveal_at - interval '12 seconds'
   where id = pg_temp.current_round();
  perform pg_temp.as_user(p_as);
  perform public.heartbeat(pg_temp.room());
  perform pg_temp.as_admin();
end;
$$;

create function pg_temp.start_next(p_as text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_as);
  perform public.start_next_round(pg_temp.room());
  perform pg_temp.as_admin();
end;
$$;

create function pg_temp.total(p_player text) returns integer language sql as $$
  select (e ->> 'total_points')::integer
    from jsonb_array_elements(public.get_game_summary(pg_temp.room()) -> 'standings') e
   where e ->> 'player_id' = p_player;
$$;

-- --------------------------------------------------------------------------
-- Round 1
-- --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select set_config('test.code', public.create_room('Стоян', 4), true);
select pg_temp.as_admin();
select set_config('test.room', (select id::text from public.rooms where code = current_setting('test.code')), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.join_room(current_setting('test.code'), 'Деси');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.join_room(current_setting('test.code'), 'Калоян');
select pg_temp.as_admin();
update public.room_players set joined_at = now() - interval '3 minutes' where player_id = '00000000-0000-0000-0000-0000000000a1';
update public.room_players set joined_at = now() - interval '2 minutes' where player_id = '00000000-0000-0000-0000-0000000000b2';
update public.room_players set joined_at = now() - interval '1 minute' where player_id = '00000000-0000-0000-0000-0000000000c3';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.start_game(pg_temp.room());
select pg_temp.as_admin();

select set_config('test.r1', pg_temp.play_to_reveal('{
  "00000000-0000-0000-0000-0000000000a1": {"country": "Малта", "city": "Монтана"},
  "00000000-0000-0000-0000-0000000000b2": {"city": "Монтана"},
  "00000000-0000-0000-0000-0000000000c3": {"city": "Мездра"}
}'::jsonb)::text, true);
select is(pg_temp.phase(), 'REVEAL', 'round 1 reaches REVEAL');

-- 4. Not from REVEAL.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'wrong_phase',
  'no next round while the reveal is running');
select pg_temp.as_admin();

select pg_temp.finish_reveal('00000000-0000-0000-0000-0000000000a1');
select is(pg_temp.phase(), 'RESULTS', 'round 1 reaches RESULTS');

-- 1. Non-host.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'not_host',
  'a non-host cannot start the next round');
-- 23. No finalization before all letters are used.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.finish_game(pg_temp.room()) $$, 'P0001', 'letters_remaining',
  'the game cannot be finished before all 28 letters were played');
select pg_temp.as_admin();

-- 5. Fewer than 2 eligible players → no next round, and the game is NOT finished.
update public.room_players set last_seen_at = now() - interval '60 seconds'
 where room_id = pg_temp.room() and player_id <> '00000000-0000-0000-0000-0000000000a1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'not_enough_players',
  'a next round needs at least 2 eligible players');
select pg_temp.as_admin();
select is(pg_temp.phase(), 'RESULTS', 'the room waits on RESULTS instead of finishing');
update public.room_players set last_seen_at = now() where room_id = pg_temp.room();

-- 2. Former host after migration.
update public.room_players set last_seen_at = now() - interval '60 seconds'
 where room_id = pg_temp.room() and player_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.heartbeat(pg_temp.room());
select pg_temp.as_admin();
select is((select host_player_id from public.rooms where id = pg_temp.room()),
  '00000000-0000-0000-0000-0000000000b2'::uuid, 'host migrated to Desi during RESULTS');
select is(pg_temp.phase(), 'RESULTS', 'host migration keeps RESULTS');
update public.room_players set last_seen_at = now() where room_id = pg_temp.room();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'not_host',
  'the former host cannot start the next round');
select pg_temp.as_admin();

-- Kaloyan leaves before the next snapshot.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.leave_room(pg_temp.room());
select pg_temp.as_admin();

-- --------------------------------------------------------------------------
-- Round 2 (new host Desi)
-- --------------------------------------------------------------------------
select lives_ok($$ select pg_temp.start_next('00000000-0000-0000-0000-0000000000b2') $$,
  'the current host starts round 2');
select set_config('test.r2', pg_temp.current_round()::text, true);
select is(pg_temp.phase(), 'ROUND_WAITING', 'round 2 starts in ROUND_WAITING');
select is((select round_number from public.rounds where id = pg_temp.current_round()), 2::smallint,
  'round number increments to 2');
select is((select letter from public.rounds where id = pg_temp.current_round()), null,
  'no letter is drawn when the next round is created');
select is((select started_at from public.rounds where id = pg_temp.current_round()), null,
  'no timer is started when the next round is created');

-- 15. Repeated request.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'round_already_started',
  'a repeated next-round request is rejected');
select pg_temp.as_admin();
select is((select count(*) from public.rounds where room_id = pg_temp.room()), 2::bigint,
  'still exactly two rounds');

-- 6–7. Snapshots.
select is((select array_agg(player_id order by player_id) from public.answer_sheets where round_id = current_setting('test.r2')::uuid),
  array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2']::uuid[],
  'round 2 snapshot = active members (Kaloyan left)');
select is((select count(*) from public.answer_sheets where round_id = current_setting('test.r1')::uuid),
  3::bigint, 'the round 1 snapshot is unchanged');

-- 8–10. Fresh readiness, no copied answers.
select is((select count(*) from public.ready_checks where round_id = current_setting('test.r2')::uuid),
  0::bigint, 'nobody is ready at the start of round 2');
select is((select count(*) from public.ready_checks where round_id = current_setting('test.r1')::uuid),
  6::bigint, 'round 1 readiness stays as history');
select is(public.all_required_ready(current_setting('test.r2')::uuid, 'pre_round'), false,
  'round 1 readiness does not count for round 2');
select is((select count(*) from public.answers where round_id = current_setting('test.r2')::uuid),
  0::bigint, 'no answers are carried into round 2');

-- 18. Kaloyan comes back after the snapshot: member again, but not in round 2.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select lives_ok(format($$ select public.join_room(%L, 'Калоян') $$, current_setting('test.code')),
  'a former participant may rejoin the running game');
select throws_ok($$ select public.set_round_ready(pg_temp.room()) $$, 'P0001', 'not_participant',
  'a player who returned after the snapshot sits out the current round');
select pg_temp.as_admin();
select is((select count(*) from public.answer_sheets where round_id = current_setting('test.r2')::uuid),
  2::bigint, 'the round 2 snapshot is not changed by the rejoin');

-- 12. The previous round is frozen once the next round exists.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  format($$ select public.set_answer_invalidated(pg_temp.room(), %L, '00000000-0000-0000-0000-0000000000a1', 'country', true) $$,
         current_setting('test.r1')),
  'P0001', 'round_not_active', 'answers of a previous round can no longer be invalidated');
select pg_temp.as_admin();

-- Play round 2: Stoyan's "Мездра" is unique even though Kaloyan wrote it in round 1.
select pg_temp.play_to_reveal('{
  "00000000-0000-0000-0000-0000000000a1": {"city": "Мездра"},
  "00000000-0000-0000-0000-0000000000b2": {"city": "Малко Търново"}
}'::jsonb);
select pg_temp.finish_reveal('00000000-0000-0000-0000-0000000000b2');
select is((select state from public.round_cells(current_setting('test.r2')::uuid)
            where player_id = '00000000-0000-0000-0000-0000000000a1' and category = 'city'),
  'unique', 'duplicates never span rounds');
select isnt((select letter from public.rounds where id = current_setting('test.r2')::uuid),
  (select letter from public.rounds where id = current_setting('test.r1')::uuid),
  'round 2 gets a different letter');
select throws_ok(
  format($$ update public.rounds set letter = (select letter from public.rounds where id = %L) where id = %L $$,
         current_setting('test.r1'), current_setting('test.r2')),
  '23505', null, 'a letter can never be stored twice in one room');

-- 13. The current RESULTS round stays invalidatable.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  format($$ select public.set_answer_invalidated(pg_temp.room(), %L, '00000000-0000-0000-0000-0000000000a1', 'city', true) $$,
         current_setting('test.r2')),
  'the current round can still be invalidated');
select lives_ok(
  format($$ select public.set_answer_invalidated(pg_temp.room(), %L, '00000000-0000-0000-0000-0000000000a1', 'city', false) $$,
         current_setting('test.r2')),
  'and restored');
select pg_temp.as_admin();

-- --------------------------------------------------------------------------
-- Round 3: Kaloyan is back in the snapshot
-- --------------------------------------------------------------------------
select pg_temp.start_next('00000000-0000-0000-0000-0000000000b2');
select set_config('test.r3', pg_temp.current_round()::text, true);
select is((select count(*) from public.answer_sheets where round_id = current_setting('test.r3')::uuid),
  3::bigint, '17. a player who returned before the next snapshot participates again');
select pg_temp.play_to_reveal('{
  "00000000-0000-0000-0000-0000000000b2": {"country": "Бразилия"},
  "00000000-0000-0000-0000-0000000000c3": {"country": "Венецуела"}
}'::jsonb);
select pg_temp.finish_reveal('00000000-0000-0000-0000-0000000000b2');

-- Totals so far: R1 Stoyan 1 / Desi 0 / Kaloyan 1; R2 Stoyan 1 / Desi 1; R3 Desi 1 / Kaloyan 1.
select is(pg_temp.total('00000000-0000-0000-0000-0000000000a1'), 2, 'Stoyan: 1 + 1 + 0');
select is(pg_temp.total('00000000-0000-0000-0000-0000000000b2'), 2, 'Desi: 0 + 1 + 1');
select is(pg_temp.total('00000000-0000-0000-0000-0000000000c3'), 2,
  '33. Kaloyan (absent in round 2): 1 + 1, no fabricated round');
select is((select (e ->> 'rounds_played')::integer
             from jsonb_array_elements(public.get_game_summary(pg_temp.room()) -> 'standings') e
            where e ->> 'player_id' = '00000000-0000-0000-0000-0000000000c3'),
  2, 'Kaloyan played 2 of 3 rounds');

-- --------------------------------------------------------------------------
-- Rounds 4–27 (no points scored)
-- --------------------------------------------------------------------------
do $$
begin
  for i in 4..27 loop
    perform pg_temp.start_next('00000000-0000-0000-0000-0000000000b2');
    perform pg_temp.play_to_reveal('{}'::jsonb);
    perform pg_temp.finish_reveal('00000000-0000-0000-0000-0000000000b2');
  end loop;
end;
$$;
select is((select count(*) from public.rounds where room_id = pg_temp.room()), 27::bigint, '27 rounds played');
select is(public.letters_used(pg_temp.room()), 27, '27 distinct letters used');
select is((select array_agg(round_number order by round_number) from public.rounds where room_id = pg_temp.room()),
  (select array_agg(n::smallint order by n) from generate_series(1, 27) n),
  'round numbers are sequential without gaps');
select set_config('test.last_letter', (
  select l from unnest(public.eligible_letters()) l
   where not exists (select 1 from public.rounds r where r.room_id = pg_temp.room() and r.letter = l)), true);
select is((select count(*) from unnest(public.eligible_letters()) l
            where not exists (select 1 from public.rounds r where r.room_id = pg_temp.room() and r.letter = l)),
  1::bigint, 'after 27 rounds exactly one letter remains');

-- --------------------------------------------------------------------------
-- Round 28
-- --------------------------------------------------------------------------
select pg_temp.start_next('00000000-0000-0000-0000-0000000000b2');
select pg_temp.play_to_reveal('{}'::jsonb);
select is((select letter from public.rounds where id = pg_temp.current_round()),
  current_setting('test.last_letter'), '19. round 28 draws the only remaining letter');

-- 24. Not before RESULTS.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.finish_game(pg_temp.room()) $$, 'P0001', 'wrong_phase',
  'the game cannot be finished during the final reveal');
select pg_temp.as_admin();
select pg_temp.finish_reveal('00000000-0000-0000-0000-0000000000b2');
select is(pg_temp.phase(), 'RESULTS', 'round 28 reaches RESULTS (not FINISHED automatically)');
select is((public.get_game_state(pg_temp.room()) #>> '{progress,is_final_round}')::boolean, true,
  'the game state reports the final round');

-- 22. No round 29 through the RPC…
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'no_letters_left',
  'no next round once all letters are used');
select pg_temp.as_admin();
-- 20–21. …nor directly in the table.
select throws_ok(
  $$ insert into public.rounds (room_id, round_number) values (pg_temp.room(), 29) $$,
  '23514', null, 'round 29 cannot exist');

-- 25–27. Finalization.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.finish_game(pg_temp.room()) $$, 'P0001', 'not_host',
  'a non-host cannot finish the game');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.finish_game(pg_temp.room()) $$, 'the host finishes the game');
select pg_temp.as_admin();
select is(pg_temp.phase(), 'FINISHED', 'the room is FINISHED');
select set_config('test.finished_at', (select finished_at::text from public.rooms where id = pg_temp.room()), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.finish_game(pg_temp.room()) $$, 'finishing again is a harmless no-op');
select pg_temp.as_admin();
select is((select finished_at::text from public.rooms where id = pg_temp.room()), current_setting('test.finished_at'),
  'a repeated finish does not change anything');

-- 28–31. FINISHED is terminal.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  format($$ select public.set_answer_invalidated(pg_temp.room(), %L, '00000000-0000-0000-0000-0000000000b2', 'country', true) $$,
         current_setting('test.r3')),
  'P0001', 'round_not_active', 'no invalidation after FINISHED (historical round)');
select throws_ok(
  $$ select public.set_answer_invalidated(pg_temp.room(), pg_temp.current_round(), '00000000-0000-0000-0000-0000000000b2', 'country', true) $$,
  'P0001', 'results_not_available', 'no invalidation after FINISHED (final round)');
select throws_ok(
  $$ select public.save_answers(pg_temp.room(), pg_temp.current_round(), '{"city":"Х"}'::jsonb) $$,
  'P0001', 'answers_locked', 'no answer changes after FINISHED');
select throws_ok($$ select public.set_round_ready(pg_temp.room()) $$, 'P0001', 'game_finished',
  'no ready actions after FINISHED');
select throws_ok($$ select public.set_results_ready(pg_temp.room()) $$, 'P0001', 'game_finished',
  'no results-ready after FINISHED');
select throws_ok($$ select public.start_next_round(pg_temp.room()) $$, 'P0001', 'game_finished',
  'no new rounds after FINISHED');

-- 32, 34–35. Final standings and history stay readable.
select is((select jsonb_agg((e ->> 'total_points')::integer order by e ->> 'player_id')
             from jsonb_array_elements(public.get_game_summary(pg_temp.room()) -> 'standings') e),
  '[2, 2, 2]'::jsonb, 'final totals are preserved and the three-way tie for first stays a tie');
select is((public.get_game_summary(pg_temp.room()) ->> 'rounds_completed')::integer, 28,
  'the summary reports 28 completed rounds');
select is((public.get_round_results(pg_temp.room(), current_setting('test.r1')::uuid) #>> '{round,number}')::integer,
  1, 'historical round results are still readable after FINISHED');

select * from finish();
rollback;
