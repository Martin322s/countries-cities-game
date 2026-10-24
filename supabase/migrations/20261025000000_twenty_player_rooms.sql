-- Raise the room capacity limit for existing and fresh installations.
alter table public.rooms drop constraint rooms_capacity_check;
alter table public.rooms add constraint rooms_capacity_check
  check (capacity between 2 and 20);

create or replace function public.create_room(p_display_name text, p_capacity integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_name text := public.normalize_display_name(p_display_name);
  v_room_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  perform public.assert_valid_display_name(v_name);
  if p_capacity is null or p_capacity < 2 or p_capacity > 20 then
    perform public.raise_app_error('invalid_capacity');
  end if;

  -- Server-side code generation with collision retry. 31^5 ≈ 28.6M codes, so a
  -- collision is rare; repeated collisions indicate something is badly wrong.
  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_room_code();
    begin
      insert into public.rooms (code, capacity, host_player_id)
      values (v_code, p_capacity, v_uid)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        perform public.raise_app_error('room_code_unavailable');
      end if;
    end;
  end loop;

  -- rooms_host_is_member is DEFERRABLE INITIALLY DEFERRED, so the host row may
  -- follow the room row inside this transaction.
  insert into public.room_players (room_id, player_id, display_name, display_name_key)
  values (v_room_id, v_uid, v_name, public.display_name_key(v_name));

  return v_code;
end;
$$;
