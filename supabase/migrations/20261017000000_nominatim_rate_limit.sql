create table public.geographic_validation_rate_limit (
  id boolean primary key default true check (id),
  next_request_at timestamptz not null default '-infinity'
);

insert into public.geographic_validation_rate_limit (id) values (true);

alter table public.geographic_validation_rate_limit enable row level security;
revoke all on public.geographic_validation_rate_limit from public, anon, authenticated, service_role;

create function public.reserve_geographic_lookup_slot()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
  v_wait_ms integer;
begin
  select next_request_at into v_next
    from public.geographic_validation_rate_limit
   where id
   for update;

  v_wait_ms := case
    when isfinite(v_next) then greatest(0, ceil(extract(epoch from (v_next - v_now)) * 1000)::integer)
    else 0
  end;

  update public.geographic_validation_rate_limit
     set next_request_at = greatest(v_next, v_now) + interval '1 second'
   where id;

  return v_wait_ms;
end;
$$;

revoke all on function public.reserve_geographic_lookup_slot() from public, anon, authenticated;
grant execute on function public.reserve_geographic_lookup_slot() to service_role;
