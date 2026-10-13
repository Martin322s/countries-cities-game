begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir ../helpers/geographic_validation.sql
\ir ../helpers/three_player_round.sql

select is(public.claim_geographic_validation(pg_temp.room(), pg_temp.current_round()), null::jsonb,
  'no geographic worker job before the ready barrier');
select pg_temp.ready_all();
select pg_temp.shift(interval '10 seconds');
select set_config('test.letter', (select letter from public.rounds where id = pg_temp.current_round()), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_answers(pg_temp.room(), pg_temp.current_round(), jsonb_build_object(
  'country', current_setting('test.letter') || 'country',
  'city', current_setting('test.letter') || 'city',
  'animal', current_setting('test.letter') || 'animal'));
select public.lock_answers(pg_temp.room(), pg_temp.current_round());
select public.set_results_ready(pg_temp.room());
select pg_temp.as_admin();
select is(pg_temp.phase(), 'RESULTS_READY', 'one READY cannot start geographic validation');
select is(public.claim_geographic_validation(pg_temp.room(), pg_temp.current_round()), null::jsonb,
  'worker cannot bypass READY');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.claim_geographic_validation(pg_temp.room(), pg_temp.current_round()) $$,
  '42501', null, 'clients cannot claim or read geographic worker data');
select public.set_results_ready(pg_temp.room());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select public.complete_geographic_validation(
  pg_temp.room(), pg_temp.current_round(), gen_random_uuid(), '[]'::jsonb) $$,
  '42501', null, 'clients cannot publish geographic decisions');
select public.set_results_ready(pg_temp.room());
select pg_temp.as_admin();
select is(pg_temp.phase(), 'MAP_VALIDATING', 'all READY starts geographic validation');
select set_config('test.job', public.claim_geographic_validation(
  pg_temp.room(), pg_temp.current_round())::text, true);
select is(jsonb_array_length(current_setting('test.job')::jsonb -> 'answers'), 2,
  'worker receives only country and city answers');
select is(public.claim_geographic_validation(pg_temp.room(), pg_temp.current_round()), null::jsonb,
  'second worker cannot claim concurrently');
select throws_ok($$ select public.complete_geographic_validation(
  pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid, '[]'::jsonb) $$,
  'P0001', 'invalid_validation_payload', 'incomplete geographic decisions cannot publish');
select is(public.complete_geographic_validation(
  pg_temp.room(), pg_temp.current_round(), gen_random_uuid(), '[]'::jsonb), false,
  'stale lease cannot complete');
select is(public.complete_geographic_validation(
  pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid,
  '[{"player_id":"00000000-0000-0000-0000-0000000000a1","category":"country","status":"VALID","reason":null,"suggestion":null},
    {"player_id":"00000000-0000-0000-0000-0000000000a1","category":"city","status":"INVALID","reason":"WRONG_CATEGORY","suggestion":null}]'),
  true, 'geographic results complete atomically');
select is(pg_temp.phase(), 'REVEAL', 'completion starts synchronized reveal');
select is((select validation_status::text from public.answers
  where round_id = pg_temp.current_round() and category = 'animal'), 'PENDING',
  'non-geographic answers are not automatically validated');
select is((select points from public.round_cells(pg_temp.current_round())
  where player_id = '00000000-0000-0000-0000-0000000000a1' and category = 'city'), 0,
  'a map-invalid geographic answer scores zero');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.set_answer_invalidated(pg_temp.room(), pg_temp.current_round(),
  '00000000-0000-0000-0000-0000000000a1', 'city', false);
select pg_temp.as_admin();
select is((select validation_status::text from public.answers
  where round_id = pg_temp.current_round() and category = 'city'), 'VALID',
  'host can restore a geographic answer rejected by map data');
select is((select points from public.round_cells(pg_temp.current_round())
  where player_id = '00000000-0000-0000-0000-0000000000a1' and category = 'city'), 1,
  'restored geographic answer scores normally');
select is((select points from public.round_cells(pg_temp.current_round())
  where player_id = '00000000-0000-0000-0000-0000000000a1' and category = 'animal'), 1,
  'non-geographic answers remain host-judged and score normally');
select is(public.complete_geographic_validation(
  pg_temp.room(), pg_temp.current_round(),
  (current_setting('test.job')::jsonb ->> 'claim')::uuid, '[]'::jsonb), false,
  'completion retry has no effect');
select * from finish();
rollback;
