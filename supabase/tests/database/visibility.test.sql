-- pgTAP tests for fair-play visibility monitoring and permanent per-round locks.
-- Run with:  npx supabase test db
--
-- now() is constant inside this test transaction, so "time passes" by shifting round
-- timestamps (as postgres). Intervals that must start in the past are inserted as
-- postgres; every other event goes through the real RPC while impersonating players.

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

\ir ../helpers/three_player_round.sql

select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) $$,
  'P0001', 'wrong_phase', 'no lock before PLAYING');
select pg_temp.ready_all();
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) $$,
  'P0001', 'wrong_phase', 'no lock during countdown');
select is(public.round_duration(), interval '90 seconds', 'server duration is 90 seconds');
select pg_temp.shift(interval '10 seconds');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is(public.report_visibility(pg_temp.room(), pg_temp.current_round(), false, false,
  '{"city":"Snapshot"}'::jsonb) ->> 'state', 'locked', 'away atomically saves and locks');
select throws_ok($$ select public.save_answers(pg_temp.room(), pg_temp.current_round(), '{"city":"Changed"}') $$,
  'P0001', 'answers_locked', 'backend refuses later saves');
select is((select raw_value from public.answers where category = 'city'), 'Snapshot', 'snapshot is preserved');
select pg_temp.as_admin();
select is((select lock_reason::text from public.answer_sheets where round_id = pg_temp.current_round()
  and player_id = '00000000-0000-0000-0000-0000000000b2'), 'tab_exit', 'reason is persisted');
select is(pg_temp.phase(), 'PLAYING', 'one player lock does not end the round');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) ->> 'state', 'locked', 'duplicate away is harmless');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2'), 1::bigint, 'one history event');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', true) -> 'event', 'null'::jsonb, 'return cannot unlock');
select is((select count(*) from public.answer_sheets where round_id = pg_temp.current_round() and submitted_at is null),
  2::bigint, 'other players continue');
select is((select ended_by::text from public.visibility_events where round_id = pg_temp.current_round()),
  'answers_locked', 'lock finalizes activity');
select has_function('public', 'report_visibility', array['uuid','uuid','boolean','boolean','jsonb'], 'no client identity or timestamps');
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000d4', false) $$,
  'P0001', 'not_member', 'outsiders cannot lock');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
select is((select count(*) from public.visibility_events), 0::bigint, 'RLS hides activity from outsiders');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ update public.answer_sheets set submitted_at = null $$, '42501', null, 'no direct unlock');
select throws_ok($$ update public.rooms set phase = 'REVEAL' $$, '42501', null, 'no direct transitions');
select public.lock_answers(pg_temp.room(), pg_temp.current_round());
select pg_temp.as_admin();
select is(pg_temp.phase(), 'RESULTS_READY', 'STOP locks everyone');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000c3', false) ->> 'state', 'locked', 'away racing STOP is harmless');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000c3'), 0::bigint, 'no late event');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select public.save_answers(pg_temp.room(), pg_temp.current_round(), '{"city":"Late"}') $$,
  'P0001', 'answers_locked', 'STOP rejects saves from others');
select pg_temp.as_admin();
create function pg_temp.to_results() returns void language plpgsql as $$
declare v_player uuid;
begin
  for v_player in select player_id from public.answer_sheets where round_id = pg_temp.current_round() loop
    perform pg_temp.as_user(v_player::text);
    perform public.set_results_ready(pg_temp.room());
    perform pg_temp.as_admin();
  end loop;
  update public.rounds set reveal_at = reveal_at - interval '12 seconds' where id = pg_temp.current_round();
  perform public.advance_game(pg_temp.room());
end;
$$;
select pg_temp.to_results();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.start_next_round(pg_temp.room());
select pg_temp.as_admin();
select pg_temp.ready_all();
select pg_temp.shift(interval '10 seconds');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.save_answers(pg_temp.room(), pg_temp.current_round(), '{"city":"New"}') $$, 'next round resets lock');
select pg_temp.as_admin();
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'new round has no activity');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2', current_setting('test.r1')::uuid), 1::bigint, 'old history preserved');
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false, false, current_setting('test.r1')::uuid) $$,
  'P0001', 'round_not_active', 'cannot lock old round');
select pg_temp.shift(interval '60 seconds');
select pg_temp.report('00000000-0000-0000-0000-0000000000c3', false);
select is(pg_temp.phase(), 'RESULTS_READY', 'timeout uses ready phase');
select is((select lock_reason::text from public.rounds where id = pg_temp.current_round()), 'timeout', 'timeout reason');
select is((select locked_at = ends_at from public.rounds where id = pg_temp.current_round()), true, 'deadline is lock time');
update public.rooms set phase = 'FINISHED', finished_at = now() where id = pg_temp.room();
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000c3', false) $$,
  'P0001', 'game_finished', 'FINISHED blocks locks');
select * from finish();
rollback;
