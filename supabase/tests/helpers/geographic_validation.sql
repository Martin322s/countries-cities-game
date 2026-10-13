-- Test-only deterministic worker. Never installed by a production migration.
create function pg_temp.finish_validation(p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_round uuid;
  v_job jsonb;
  v_results jsonb;
begin
  select current_round_id into v_round from public.rooms where id = p_room;
  v_job := public.claim_geographic_validation(p_room, v_round);
  if v_job is null then raise exception 'No validation job to complete'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', a ->> 'player_id',
           'category', a ->> 'category', 'status', 'VALID', 'reason', null, 'suggestion', null)),
           '[]'::jsonb)
    into v_results from jsonb_array_elements(v_job -> 'answers') a;
  if not public.complete_geographic_validation(
    p_room, v_round, (v_job ->> 'claim')::uuid, v_results
  ) then
    raise exception 'Validation did not complete';
  end if;
end;
$$;
grant execute on function pg_temp.finish_validation(uuid) to authenticated;
