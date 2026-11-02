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

