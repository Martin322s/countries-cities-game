-- pgTAP: production hardening — size guards, rate limiting, retention cleanup.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, aud, role, is_anonymous, created_at, last_sign_in_at)
values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', true, now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', true, now(), now()),
  -- An old anonymous identity that belongs to no room: cleanup removes it.
  ('00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', true,
   now() - interval '90 days', now() - interval '60 days'),
  -- An old identity that still belongs to a room: kept.
  ('00000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', true,
   now() - interval '90 days', now() - interval '60 days');

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

-- --------------------------------------------------------------------------
-- Size guards: rejected before any expensive normalization
-- --------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.create_room(repeat('Я', 100000), 4) $$, 'P0001',
  'invalid_display_name', 'a 100 000-character name is rejected');
select throws_ok($$ select public.join_room(repeat('A', 100000), 'Деси') $$, 'P0001',
  'invalid_room_code', 'a 100 000-character code is rejected');
select pg_temp.as_admin(); -- internal helpers are not callable by clients
select is(public.normalize_room_code(' k7m-4q '), 'K7M4Q', 'normal code input still normalizes');
select is(public.normalize_display_name('  Деси   Петрова '), 'Деси Петрова',
  'normal names still normalize');
select throws_ok($$ select public.clean_answer(repeat('а', 401)) $$, 'P0001', 'answer_too_long',
  'an absurdly long answer is rejected before normalization');
select is(public.clean_answer('  Монтана  '), 'Монтана', 'normal answers still clean');

-- --------------------------------------------------------------------------
-- Rate limiting (the hook as PostgREST runs it)
-- --------------------------------------------------------------------------
create function pg_temp.request(p_sub text, p_path text, p_method text default 'POST',
                                p_length text default '120')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.path', p_path, true);
  perform set_config('request.method', p_method, true);
  perform set_config('request.headers', json_build_object('content-length', p_length)::text, true);
  perform set_config('role', 'authenticated', true);
  perform private.check_request();
  perform set_config('role', 'postgres', true);
end;
$$;
grant execute on function pg_temp.request(text, text, text, text) to authenticated;

select lives_ok($$
  select pg_temp.request('00000000-0000-0000-0000-0000000000b2', '/rpc/create_room')
    from generate_series(1, 10)
$$, 'ten room creations within the window are fine');
select throws_ok($$ select pg_temp.request('00000000-0000-0000-0000-0000000000b2', '/rpc/create_room') $$,
  'P0001', 'rate_limited', 'the eleventh room creation is rate limited');
select lives_ok($$ select pg_temp.request('00000000-0000-0000-0000-0000000000a1', '/rpc/create_room') $$,
  'limits are per identity: another player is unaffected');
select lives_ok($$ select pg_temp.request('00000000-0000-0000-0000-0000000000b2', '/rpc/heartbeat') $$,
  'limits are per operation: heartbeats still work');

-- A fast typist: 2 saves per second for a whole minute stays within the budget.
select lives_ok($$
  select pg_temp.request('00000000-0000-0000-0000-0000000000a1', '/rpc/save_answers')
    from generate_series(1, 240)
$$, 'autosave at 4/s for a minute is never limited');

select lives_ok($$
  select pg_temp.request('00000000-0000-0000-0000-0000000000a1', '/rooms', 'GET')
    from generate_series(1, 3000)
$$, 'read-only requests are not counted (read-only transactions)');
select throws_ok($$ select pg_temp.request('00000000-0000-0000-0000-0000000000a1', '/rpc/save_answers', 'POST', '20000') $$,
  'P0001', 'payload_too_large', 'oversized request bodies are rejected');
select lives_ok($$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true),
         set_config('request.path', '/rpc/create_room', true),
         private.check_request()
    from generate_series(1, 50)
$$, 'the service role is never limited');
select pg_temp.as_admin();

select is((select max_requests from private.rate_limit_rules where op = 'save_answers'), 600,
  'autosave budget is 600/min (≥ 5× the fastest legitimate typing)');

-- Failed join lookups count (and survive) — guessing is limited.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from generate_series(1, 20) g
            where public.join_room('ZZZZ' || substr('ABCDEFGHJKMNPQRSTUVW', g, 1), 'Деси') is null),
          20::bigint, '20 unknown codes return NULL');
select throws_ok($$ select public.join_room('ZZZZZ', 'Деси') $$, 'P0001', 'rate_limited',
  'the 21st failed lookup within 10 minutes is rate limited');
select pg_temp.as_admin();

-- --------------------------------------------------------------------------
-- Retention cleanup
-- --------------------------------------------------------------------------
-- Rooms: fresh lobby, abandoned lobby, playing (active), abandoned game, finished
-- recent, finished expired. Built directly (as postgres) with backdated timestamps.
create function pg_temp.mk_room(p_code text, p_phase public.game_phase, p_age interval,
                                p_finished interval default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.rooms (code, capacity, host_player_id, phase, created_at, updated_at, finished_at)
  values (p_code, 4, '00000000-0000-0000-0000-0000000000d4', p_phase, now() - p_age, now() - p_age,
          case when p_finished is null then null else now() - p_finished end)
  returning id into v_id;
  insert into public.room_players (room_id, player_id, display_name, display_name_key, joined_at, last_seen_at)
  values (v_id, '00000000-0000-0000-0000-0000000000d4', 'Стоян', 'стоян', now() - p_age, now() - p_age);
  return v_id;
end;
$$;

select set_config('t.fresh', pg_temp.mk_room('AAAA2', 'LOBBY', interval '2 hours')::text, true);
select set_config('t.old_lobby', pg_temp.mk_room('AAAA3', 'LOBBY', interval '30 hours')::text, true);
select set_config('t.active', pg_temp.mk_room('AAAA4', 'PLAYING', interval '5 minutes')::text, true);
select set_config('t.old_game', pg_temp.mk_room('AAAA5', 'RESULTS', interval '30 hours')::text, true);
select set_config('t.fin_recent', pg_temp.mk_room('AAAA6', 'FINISHED', interval '3 days', interval '3 days')::text, true);
select set_config('t.fin_old', pg_temp.mk_room('AAAA7', 'FINISHED', interval '9 days', interval '8 days')::text, true);
-- A player reconnects just before cleanup: the old lobby shows a fresh heartbeat.
select set_config('t.revived', pg_temp.mk_room('AAAA8', 'LOBBY', interval '30 hours')::text, true);
update public.room_players set last_seen_at = now()
 where room_id = current_setting('t.revived')::uuid;
-- Stale counters.
insert into private.rate_limit_counters values
  ('00000000-0000-0000-0000-0000000000a1', 'heartbeat', now() - interval '3 hours', 5);

select ok((private.cleanup_expired_data() ->> 'rooms')::int >= 3, 'cleanup reports deleted rooms');

select ok(exists (select 1 from public.rooms where id = current_setting('t.fresh')::uuid),
  'a fresh lobby is kept');
select ok(exists (select 1 from public.rooms where id = current_setting('t.active')::uuid),
  'an active game is kept');
select ok(exists (select 1 from public.rooms where id = current_setting('t.fin_recent')::uuid),
  'a game finished 3 days ago is kept');
select ok(exists (select 1 from public.rooms where id = current_setting('t.revived')::uuid),
  'a room with a just-reconnected player is kept');
select ok(not exists (select 1 from public.rooms
                       where id in (current_setting('t.old_lobby')::uuid,
                                    current_setting('t.old_game')::uuid,
                                    current_setting('t.fin_old')::uuid)),
  'abandoned lobby, abandoned game and expired finished game are deleted');
select is((select count(*) from public.room_players
            where room_id in (current_setting('t.old_lobby')::uuid, current_setting('t.fin_old')::uuid)),
  0::bigint, 'their memberships are gone too (no orphans)');
select ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000c3')
      and exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d4'),
  'old room-less anonymous users are removed; users with rooms are kept');

select * from finish();
rollback;
