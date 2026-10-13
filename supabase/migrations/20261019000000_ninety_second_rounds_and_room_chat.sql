create or replace function public.round_duration()
returns interval language sql immutable set search_path = ''
as $$ select interval '90 seconds' $$;

create or replace function public.can_access_room_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^(room|room-chat):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_room_member(substring(p_topic from position(':' in p_topic) + 1)::uuid)
    else false
  end;
$$;

create or replace function public.advance_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_letter text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.current_round_id is null then
    return;
  end if;
  select * into v_round from public.rounds where id = v_room.current_round_id for update;

  if v_room.phase = 'ROUND_WAITING' and public.all_required_ready(v_round.id, 'pre_round') then
    select l into v_letter
      from unnest(public.eligible_letters()) as l
     where not exists (
       select 1 from public.rounds r where r.room_id = p_room_id and r.letter = l)
     order by gen_random_uuid()
     limit 1;

    if v_letter is null then
      update public.rooms set phase = 'FINISHED' where id = p_room_id;
      return;
    end if;

    update public.rounds
       set letter = v_letter,
           countdown_at = now(),
           started_at = now() + public.countdown_duration(),
           ends_at = now() + public.countdown_duration() + public.round_duration()
     where id = v_round.id
     returning * into v_round;
    update public.rooms set phase = 'COUNTDOWN' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'COUNTDOWN' and clock_timestamp() >= v_round.started_at then
    update public.rooms
       set phase = 'PLAYING', used_letters = used_letters || v_round.letter
     where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'PLAYING' then
    if clock_timestamp() >= v_round.ends_at then
      update public.rounds
         set locked_at = v_round.ends_at, lock_reason = 'timeout'
       where id = v_round.id returning * into v_round;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
    elsif public.all_answers_locked(v_round.id) then
      update public.rounds
         set locked_at = clock_timestamp(), lock_reason = 'all_ready'
       where id = v_round.id returning * into v_round;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;
    end if;
  end if;

  if v_room.phase in ('ROUND_LOCKED', 'RESULTS_READY')
     and public.all_required_ready(v_round.id, 'pre_results') then
    update public.rounds set reveal_at = now()
     where id = v_round.id and reveal_at is null returning * into v_round;
    select * into v_round from public.rounds where id = v_room.current_round_id;
    update public.rooms set phase = 'REVEAL' where id = p_room_id returning * into v_room;
  end if;

  if v_room.phase = 'REVEAL' and v_round.reveal_at is not null
     and clock_timestamp() >= v_round.reveal_at + public.reveal_duration() then
    update public.rooms set phase = 'RESULTS' where id = p_room_id;
  end if;
end;
$$;

create or replace function public.lock_answers(p_room_id uuid, p_round_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_round public.rounds;
  v_sheet public.answer_sheets;
  v_now timestamptz;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);
  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('game_finished');
  end if;
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;

  select * into v_sheet from public.answer_sheets
   where round_id = p_round_id and player_id = v_uid for update;
  if not found then
    perform public.raise_app_error('not_participant');
  end if;
  if v_sheet.submitted_at is not null then return; end if;

  perform public.advance_game(p_room_id);
  select * into v_round from public.rounds where id = p_round_id;
  if v_round.locked_at is not null then return; end if;
  v_now := clock_timestamp();
  if v_round.started_at is null or v_now < v_round.started_at then
    perform public.raise_app_error('wrong_phase');
  end if;
  if v_now >= v_round.ends_at then
    perform public.advance_game(p_room_id);
    return;
  end if;

  update public.answer_sheets
     set submitted_at = v_now, lock_reason = 'ready'
   where round_id = p_round_id and player_id = v_uid and submitted_at is null;
  perform public.advance_game(p_room_id);
end;
$$;
