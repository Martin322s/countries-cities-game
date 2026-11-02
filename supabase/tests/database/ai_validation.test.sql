begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir ../helpers/ai_validation.sql
\ir ../helpers/three_player_round.sql

select is(public.claim_ai_validation(pg_temp.room(), pg_temp.current_round()), null::jsonb,
  'no worker job before the ready barrier');
select pg_temp.ready_all();
select pg_temp.shift(interval '10 seconds');
select set_config('test.letter', (select letter from public.rounds where id = pg_temp.current_round()), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_answers(pg_temp.room(), pg_temp.current_round(), jsonb_build_object(
  'country', current_setting('test.letter') || 'country', 'city', current_setting('test.letter') || 'city'));
select public.lock_answers(pg_temp.room(), pg_temp.current_round());
select public.set_results_ready(pg_temp.room());
select pg_temp.as_admin();
select is(pg_temp.phase(), 'RESULTS_READY', 'one READY cannot start validation');
select is(public.claim_ai_validation(pg_temp.room(), pg_temp.current_round()), null::jsonb,
  'even the worker cannot bypass READY');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.set_ai_validation_pending(pg_temp.room()) $$,
  '42501', null, 'client cannot force AI_VALIDATING');
select throws_ok($$ select public.claim_ai_validation(pg_temp.room(), pg_temp.current_round()) $$,
  '42501', null, 'client cannot claim or read worker data');
select public.set_results_ready(pg_temp.room());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.set_results_ready(pg_temp.room());
select throws_ok($$ select public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(), '[]'::jsonb) $$,
  '42501', null, 'legacy completion cannot be called by clients');
select pg_temp.as_admin();
select is(pg_temp.phase(), 'AI_VALIDATING', 'all READY starts validation');
select is((select reveal_at from public.rounds where id = pg_temp.current_round()), null::timestamptz,
  'reveal has not begun');
select set_config('test.job', public.claim_ai_validation(pg_temp.room(), pg_temp.current_round())::text, true);
select ok(current_setting('test.job')::jsonb ->> 'claim' is not null, 'worker claims the job');
select is(public.claim_ai_validation(pg_temp.room(), pg_temp.current_round()), null::jsonb, 'second worker cannot claim concurrently');
select throws_ok($$ select public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid, '[]'::jsonb) $$,
  'P0001', 'invalid_validation_payload', 'incomplete decisions cannot publish results');
select is(public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(),
  '10000000-0000-0000-0000-000000000000', '[]'::jsonb), false, 'stale lease cannot complete');
select throws_ok($$ select public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid,
  '[{"player_id":"00000000-0000-0000-0000-0000000000a1","category":"country","status":"VALID","reason":null},
    {"player_id":"00000000-0000-0000-0000-0000000000a1","category":"city","status":"VALID","reason":"AMBIGUOUS"}]') $$,
  'P0001', 'invalid_validation_payload', 'a malformed later decision rolls back the whole batch');
select is((select count(*) from public.answers where round_id = pg_temp.current_round()
  and validation_status = 'PENDING'), 2::bigint, 'no partial validation was committed');
select is(public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid,
  '[{"player_id":"00000000-0000-0000-0000-0000000000a1","category":"country","status":"VALID","reason":null,"suggestion":null},
    {"player_id":"00000000-0000-0000-0000-0000000000a1","category":"city","status":"INVALID","reason":"AMBIGUOUS","suggestion":null}]'),
  true, 'trusted full decisions complete atomically');
select is(pg_temp.phase(), 'REVEAL', 'completion starts synchronized reveal');
select is((select points from public.round_cells(pg_temp.current_round())
  where player_id = '00000000-0000-0000-0000-0000000000a1' and category = 'city'), 0, 'AI invalid answer scores zero');
select is((select points from public.round_cells(pg_temp.current_round())
  where player_id = '00000000-0000-0000-0000-0000000000a1' and category = 'country'), 1, 'verified unique answer scores normally');
select is((select count(*) from public.round_validations), 2::bigint, 'audit rows use authoritative answers');
select is(public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid, '[]'::jsonb), false, 'completion retry has no effect');

update public.rounds set reveal_at = reveal_at - interval '12 seconds' where id = pg_temp.current_round();
select public.advance_game(pg_temp.room());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.start_next_round(pg_temp.room());
select pg_temp.as_admin();
select pg_temp.ready_all();
select pg_temp.shift(interval '10 seconds');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_answers(pg_temp.room(), pg_temp.current_round(), '{"city":"Snapshot"}');
select public.lock_answers(pg_temp.room(), pg_temp.current_round());
select public.set_results_ready(pg_temp.room());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.set_results_ready(pg_temp.room());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.set_results_ready(pg_temp.room());
select pg_temp.as_admin();
select set_config('test.old_claim', public.claim_ai_validation(pg_temp.room(), pg_temp.current_round()) ->> 'claim', true);
update public.rounds set validation_started_at = clock_timestamp() - interval '181 seconds'
 where id = pg_temp.current_round();
select public.advance_game(pg_temp.room());
select is(pg_temp.phase(), 'REVEAL', 'worker failure cannot block progression indefinitely');
select is((select validation_reason::text from public.answers where round_id = pg_temp.current_round()),
  'AMBIGUOUS', 'timeout marks unverified answers explicitly');
select is(public.complete_ai_validation(pg_temp.room(), pg_temp.current_round(),
  current_setting('test.old_claim')::uuid, '[]'::jsonb), false, 'late worker cannot overwrite timeout');
select * from finish();
rollback;
