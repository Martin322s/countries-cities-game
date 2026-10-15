-- pgTAP tests for fair-play visibility monitoring (informational, never scoring).
-- Run with:  npx supabase test db
--
-- now() is constant inside this test transaction, so "time passes" by shifting round
-- timestamps (as postgres). Intervals that must start in the past are inserted as
-- postgres; every other event goes through the real RPC while impersonating players.

begin;
create extension if not exists pgtap with schema extensions;

select plan(60);

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', true), -- Stoyan
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', true), -- Desi
  ('00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', true), -- Kaloyan
  ('00000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', true); -- outsider

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
grant execute on function pg_temp.room() to authenticated;
grant execute on function pg_temp.current_round() to authenticated;

-- Reports as the given player for the current round (or p_round), then back to postgres.
create function pg_temp.report(p_as text, p_visible boolean, p_unloading boolean default false,
                               p_round uuid default null)
returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.as_user(p_as);
  v_result := public.report_visibility(pg_temp.room(), coalesce(p_round, pg_temp.current_round()),
                                       p_visible, p_unloading);
  perform pg_temp.as_admin();
  return v_result;
end;
$$;
grant execute on function pg_temp.report(text, boolean, boolean, uuid) to authenticated;

create function pg_temp.events(p_player text, p_round uuid default null) returns bigint language sql as $$
  select count(*) from public.visibility_events
   where player_id = p_player::uuid and round_id = coalesce(p_round, pg_temp.current_round());
$$;
create function pg_temp.open_events(p_player text) returns bigint language sql as $$
  select count(*) from public.visibility_events
   where player_id = p_player::uuid and round_id = pg_temp.current_round() and returned_at is null;
$$;

-- Everyone ready → COUNTDOWN; then optionally move the timeline so PLAYING is effective.
create function pg_temp.ready_all() returns void language plpgsql as $$
declare
  v_player uuid;
begin
  for v_player in select player_id from public.answer_sheets where round_id = pg_temp.current_round() loop
    perform pg_temp.as_user(v_player::text);
    perform public.set_round_ready(pg_temp.room());
    perform pg_temp.as_admin();
  end loop;
end;
$$;
create function pg_temp.shift(p_by interval) returns void language sql as $$
  update public.rounds
     set countdown_at = countdown_at - p_by,
         started_at = started_at - p_by,
         ends_at = ends_at - p_by
   where id = pg_temp.current_round();
$$;

-- --------------------------------------------------------------------------
-- Setup: Stoyan hosts, Desi and Kaloyan join, the game starts.
-- --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select set_config('test.code', public.create_room('Стоян', 4), true);
select pg_temp.as_admin();
select set_config('test.room', (select id::text from public.rooms where code = current_setting('test.code')), true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.join_room(current_setting('test.code'), 'Деси');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.join_room(current_setting('test.code'), 'Калоян');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.start_game(pg_temp.room());
select pg_temp.as_admin();
select set_config('test.r1', pg_temp.current_round()::text, true);

-- --------------------------------------------------------------------------
-- 1. Outside PLAYING nothing is recorded
-- --------------------------------------------------------------------------
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) $$,
  'P0001', 'wrong_phase', 'away is rejected in ROUND_WAITING');

select pg_temp.ready_all();
select is(pg_temp.phase(), 'COUNTDOWN', 'round 1 is counting down');
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) $$,
  'P0001', 'wrong_phase', 'away is rejected during the countdown');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2'), 0::bigint,
  'no event exists before PLAYING');

-- Countdown over: effective PLAYING with ~100 s left.
select pg_temp.shift(interval '23 seconds');

-- --------------------------------------------------------------------------
-- 2–6. Away: own player only, server timestamp, idempotent, one open interval
-- --------------------------------------------------------------------------
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) ->> 'state', 'away',
  'Desi can report her own away');
select is(pg_temp.phase(), 'PLAYING', 'the report advanced the room to PLAYING');
select is((select away_at from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000b2'), now(),
  'away_at is the server''s now()');
select is((select room_id from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000b2'), pg_temp.room(),
  'the event belongs to the room and round decided by the server');
select is((select source::text from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000b2'), 'visibility',
  'a plain hide is recorded as a visibility event');

select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) ->> 'state', 'away',
  'a repeated away report succeeds');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2'), 1::bigint,
  'repeated away reports keep a single interval');
select throws_ok($$
  insert into public.visibility_events (round_id, player_id, room_id, away_at)
  values (pg_temp.current_round(), '00000000-0000-0000-0000-0000000000b2', pg_temp.room(), now())
$$, '23505', null, 'the database allows only one open interval per player and round');

select has_function('public', 'report_visibility', array['uuid', 'uuid', 'boolean', 'boolean'],
  'report_visibility takes no player id and no timestamps');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000a1')
          + pg_temp.events('00000000-0000-0000-0000-0000000000c3'), 0::bigint,
  'Desi''s report created nothing for anyone else');
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000d4', false) $$,
  'P0001', 'not_member', 'a non-member cannot report into the room');

-- --------------------------------------------------------------------------
-- Reading: members yes, outsiders no
-- --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.visibility_events), 1::bigint,
  'a room member can read the current round''s events');
select is(jsonb_array_length(public.get_round_activity(pg_temp.room(), pg_temp.current_round()) -> 'events'),
  1, 'get_round_activity returns the open interval to members');
select is(public.get_round_activity(pg_temp.room(), pg_temp.current_round()) -> 'events' -> 0 ->> 'returned_at',
  null, 'the interval is reported as still open');
select ok((public.get_round_activity(pg_temp.room(), pg_temp.current_round()) -> 'events' -> 0 ->> 'cap_at') is not null,
  'clients learn where an open interval must stop (cap_at)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
select is((select count(*) from public.visibility_events), 0::bigint,
  'a non-member reads no events');
select throws_ok($$ select public.get_round_activity(pg_temp.room(), pg_temp.current_round()) $$,
  'P0001', 'not_member', 'a non-member cannot load the activity');
select pg_temp.as_admin();

-- --------------------------------------------------------------------------
-- Direct writes are impossible for clients
-- --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$
  insert into public.visibility_events (round_id, player_id, room_id, away_at)
  values (pg_temp.current_round(), '00000000-0000-0000-0000-0000000000a1', pg_temp.room(), now() - interval '1 minute')
$$, '42501', null, 'clients cannot insert events (not even for someone else)');
select throws_ok($$ update public.visibility_events set away_at = now() - interval '1 hour' $$,
  '42501', null, 'clients cannot edit timestamps');
select throws_ok($$ delete from public.visibility_events $$,
  '42501', null, 'clients cannot delete history');
select pg_temp.as_admin();

-- --------------------------------------------------------------------------
-- 7–9. Return
-- --------------------------------------------------------------------------
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', true) -> 'event' ->> 'returned_at',
  (select to_jsonb(now()) ->> 0), 'return closes the interval at the server''s now()');
select is((select ended_by::text from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000b2'), 'returned',
  'the interval ended because the page came back');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', true) -> 'event', 'null'::jsonb,
  'a repeated return is harmless');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2'), 1::bigint,
  'the repeated return changed nothing');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000c3', true) -> 'event', 'null'::jsonb,
  'a return without an away is harmless');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000c3'), 0::bigint,
  'a return without an away invents no history');

-- A second away of the same player opens a new interval once the first one is closed.
select pg_temp.as_admin();
insert into public.visibility_events (round_id, player_id, room_id, away_at)
values (pg_temp.current_round(), '00000000-0000-0000-0000-0000000000b2', pg_temp.room(), now() - interval '6 seconds');
select is(pg_temp.open_events('00000000-0000-0000-0000-0000000000b2'), 1::bigint,
  'a later absence opens a new interval');
select is((pg_temp.report('00000000-0000-0000-0000-0000000000b2', true) -> 'event' ->> 'duration_ms')::numeric,
  6000::numeric, 'the duration comes from server timestamps (6 s)');

-- Unload (refresh/close) is recorded as such so clients can apply a display grace.
select is(pg_temp.report('00000000-0000-0000-0000-0000000000c3', false, true) ->> 'state', 'away',
  'an away while the page unloads is accepted');
select is((select source::text from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000c3'), 'unload',
  'it is marked as an unload');
select pg_temp.report('00000000-0000-0000-0000-0000000000c3', true);

-- --------------------------------------------------------------------------
-- 12. After READY (personal lock) no new events; an open interval is finalized
-- --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.lock_answers(pg_temp.room(), pg_temp.current_round());
select pg_temp.as_admin();
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000a1', false) $$,
  'P0001', 'answers_locked', 'a player who locked their answers cannot create an away event');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'no event exists for the locked player');

-- Kaloyan is away when she leaves the room → her sheet is locked as "left".
insert into public.visibility_events (round_id, player_id, room_id, away_at)
values (pg_temp.current_round(), '00000000-0000-0000-0000-0000000000c3', pg_temp.room(), now() - interval '3 seconds');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.leave_room(pg_temp.room());
select pg_temp.as_admin();
select is((select ended_by::text from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000c3'
              and away_at = now() - interval '3 seconds'),
  'answers_locked', 'leaving while away finalizes the interval at the lock');
select is(pg_temp.open_events('00000000-0000-0000-0000-0000000000c3'), 0::bigint,
  'no interval stays open after the player''s answers locked');
-- Kaloyan comes back (same game, same round sheet).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select public.join_room(current_setting('test.code'), 'Калоян');
select pg_temp.as_admin();

-- --------------------------------------------------------------------------
-- 10. An interval never exceeds the end of the round
-- --------------------------------------------------------------------------
-- Desi went away 30 s ago; the round ended 10 s ago, but nobody has called since.
insert into public.visibility_events (round_id, player_id, room_id, away_at)
values (pg_temp.current_round(), '00000000-0000-0000-0000-0000000000b2', pg_temp.room(), now() - interval '30 seconds');
update public.rounds
   set countdown_at = now() - interval '133 seconds',
       started_at = now() - interval '130 seconds',
       ends_at = now() - interval '10 seconds'
 where id = pg_temp.current_round();

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(
  (select e ->> 'ended_by'
     from jsonb_array_elements(public.get_round_activity(pg_temp.room(), pg_temp.current_round()) -> 'events') e
    where e ->> 'player_id' = '00000000-0000-0000-0000-0000000000b2' and e ->> 'away_at' = to_jsonb(now() - interval '30 seconds') ->> 0),
  'round_ended', 'the read model ends an interval at ends_at even before any finalization');
select is(
  (select (e ->> 'returned_at')::timestamptz
     from jsonb_array_elements(public.get_round_activity(pg_temp.room(), pg_temp.current_round()) -> 'events') e
    where e ->> 'player_id' = '00000000-0000-0000-0000-0000000000b2' and e ->> 'away_at' = to_jsonb(now() - interval '30 seconds') ->> 0),
  now() - interval '10 seconds', 'the derived end is ends_at, not the time of reading');
select pg_temp.as_admin();

select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000c3', false) $$,
  'P0001', 'round_over', 'no away after the round''s deadline');

-- Desi finally returns: her request first applies the due timeout lock, which closes
-- the interval at ends_at — so the late return itself has nothing left to close.
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', true) -> 'event', 'null'::jsonb,
  'the late return finds the interval already finalized');
select is((select extract(epoch from returned_at - away_at)::numeric from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000b2'
              and away_at = now() - interval '30 seconds'),
  20::numeric, 'the absence is clamped to ends_at (20 s, not 30 s)');
select is((select ended_by::text from public.visibility_events
            where player_id = '00000000-0000-0000-0000-0000000000b2'
              and away_at = now() - interval '30 seconds'), 'round_ended',
  'the interval is recorded as ended by the round');
select is(pg_temp.phase(), 'RESULTS_READY', 'the same request locked the round on timeout');

-- An interval still open when the round locks is closed by the lock itself.
select is((select count(*) from public.visibility_events
            where round_id = pg_temp.current_round() and returned_at is null), 0::bigint,
  'no open interval survives the round lock');

-- --------------------------------------------------------------------------
-- 16. History is immutable
-- --------------------------------------------------------------------------
select throws_ok($$
  update public.visibility_events set returned_at = returned_at + interval '1 minute'
   where round_id = current_setting('test.r1')::uuid
$$, '23514', null, 'closed intervals cannot be edited, even with privileged access');
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) $$,
  'P0001', 'round_over', 'no away after the round locked');

-- --------------------------------------------------------------------------
-- 11. Events are isolated by round
-- --------------------------------------------------------------------------
-- Through the results to round 2 (all three play it: Kaloyan rejoined before its snapshot).
create function pg_temp.to_results() returns void language plpgsql as $$
declare
  v_player uuid;
begin
  for v_player in select player_id from public.answer_sheets where round_id = pg_temp.current_round() loop
    perform pg_temp.as_user(v_player::text);
    perform public.set_results_ready(pg_temp.room());
    perform pg_temp.as_admin();
  end loop;
  update public.rounds set reveal_at = reveal_at - interval '12 seconds' where id = pg_temp.current_round();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.heartbeat(pg_temp.room());
  perform pg_temp.as_admin();
end;
$$;
select pg_temp.to_results();
select is(pg_temp.phase(), 'RESULTS', 'round 1 results');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', true) -> 'event', 'null'::jsonb,
  'a return during RESULTS is harmless');
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) $$,
  'P0001', 'round_over', 'no away during RESULTS');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.start_next_round(pg_temp.room());
select pg_temp.as_admin();
select pg_temp.ready_all();
select pg_temp.shift(interval '23 seconds');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(jsonb_array_length(public.get_round_activity(pg_temp.room(), pg_temp.current_round()) -> 'events'),
  0, 'round 2 starts with no activity');
select ok(jsonb_array_length(public.get_round_activity(pg_temp.room(), current_setting('test.r1')::uuid) -> 'events') >= 4,
  'round 1 activity stays readable as history');
select pg_temp.as_admin();

select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000b2', false, false, current_setting('test.r1')::uuid) $$,
  'P0001', 'round_not_active', 'away cannot be reported for an old round');
select is(pg_temp.report('00000000-0000-0000-0000-0000000000b2', false) ->> 'state', 'away',
  'away in round 2 is accepted');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2', current_setting('test.r1')::uuid), 3::bigint,
  'round 1 history is unchanged by round 2');
select is(pg_temp.events('00000000-0000-0000-0000-0000000000b2'), 1::bigint,
  'the new event belongs to round 2 only');

-- No scoring effect: activity never changes results.
select is((select count(*) from public.answers a
             join public.rounds r on r.id = a.round_id
            where r.room_id = pg_temp.room() and a.invalidated_at is not null), 0::bigint,
  'visibility never invalidates answers');

-- --------------------------------------------------------------------------
-- 17. FINISHED blocks new events
-- --------------------------------------------------------------------------
update public.rooms set phase = 'FINISHED', finished_at = now() where id = pg_temp.room();
select throws_ok($$ select pg_temp.report('00000000-0000-0000-0000-0000000000c3', false) $$,
  'P0001', 'game_finished', 'FINISHED blocks new visibility events');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select ok(public.get_round_activity(pg_temp.room(), current_setting('test.r1')::uuid) is not null,
  'activity history stays readable after the game');
select pg_temp.as_admin();

select * from finish();
rollback;
