-- Server-authoritative STOP and permanent per-round tab locks.
-- Reuse RESULTS_READY / pre_results and the existing Realtime status tables.
create or replace function public.round_duration()
returns interval language sql immutable set search_path = ''
as $$ select interval '60 seconds' $$;

create or replace function public.save_answers(p_room_id uuid, p_round_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_round public.rounds;
  v_sheet public.answer_sheets;
  v_entry record;
  v_value text;
begin
  -- Lock order: rooms -> sheets. Serialize saves with STOP and tab locks.
  perform public.lock_room_for_member(p_room_id, v_uid);

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    perform public.raise_app_error('invalid_answers');
  end if;

  if not exists (
    select 1 from public.room_players
     where room_id = p_room_id and player_id = v_uid and left_at is null
  ) then
    perform public.raise_app_error('not_member');
  end if;

  if not exists (
    select 1 from public.rooms where id = p_room_id and current_round_id = p_round_id
  ) then
    perform public.raise_app_error('round_not_active');
  end if;

  select * into v_sheet
    from public.answer_sheets
   where round_id = p_round_id and player_id = v_uid
   for update;
  if not found then
    perform public.raise_app_error('not_participant');
  end if;
  if v_sheet.submitted_at is not null then
    perform public.raise_app_error('answers_locked');
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if v_round.started_at is null or clock_timestamp() < v_round.started_at then
    perform public.raise_app_error('wrong_phase');
  end if;
  if v_round.locked_at is not null then
    if v_round.lock_reason = 'timeout' then
      perform public.raise_app_error('round_over');
    end if;
    perform public.raise_app_error('answers_locked');
  end if;
  if clock_timestamp() >= v_round.ends_at then
    perform public.raise_app_error('round_over');
  end if;

  for v_entry in select key, value from jsonb_each(p_answers) loop
    if v_entry.key not in ('country', 'city', 'village', 'animal', 'plant', 'object', 'name') then
      perform public.raise_app_error('invalid_category');
    end if;
    if jsonb_typeof(v_entry.value) <> 'string' then
      perform public.raise_app_error('invalid_answers');
    end if;
    v_value := public.clean_answer(v_entry.value #>> '{}');
    if char_length(v_value) > 100 then
      perform public.raise_app_error('answer_too_long');
    end if;

    insert into public.answers (round_id, player_id, category, raw_value, normalized_value)
    values (p_round_id, v_uid, v_entry.key::public.answer_category, v_value, public.normalize_answer(v_value))
    on conflict (round_id, player_id, category)
    do update set raw_value = excluded.raw_value, normalized_value = excluded.normalized_value;
  end loop;

  update public.answer_sheets set updated_at = now()
   where round_id = p_round_id and player_id = v_uid;
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

  -- ROUND_WAITING → COUNTDOWN: draw a random unused letter, fix the timeline.
  if v_room.phase = 'ROUND_WAITING' and public.all_required_ready(v_round.id, 'pre_round') then
    select l into v_letter
      from unnest(public.eligible_letters()) as l
     where not exists (
             select 1 from public.rounds r
              where r.room_id = p_room_id and r.letter = l)
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

    update public.rooms
       set phase = 'COUNTDOWN'
     where id = p_room_id
     returning * into v_room;
  end if;

  -- COUNTDOWN → PLAYING once the authoritative start time has passed.
  if v_room.phase = 'COUNTDOWN' and clock_timestamp() >= v_round.started_at then
    update public.rooms
       set phase = 'PLAYING',
           used_letters = used_letters || v_round.letter
     where id = p_room_id
     returning * into v_room;
  end if;

  -- PLAYING → (ROUND_LOCKED) → RESULTS_READY on timeout. STOP uses lock_answers.
  if v_room.phase = 'PLAYING' then
    if clock_timestamp() >= v_round.ends_at then
      update public.rounds
         set locked_at = v_round.ends_at, lock_reason = 'timeout'
       where id = v_round.id
       returning * into v_round;
      update public.rooms set phase = 'RESULTS_READY' where id = p_room_id returning * into v_room;

    end if;
  end if;

  -- RESULTS_READY → REVEAL: fix the single, shared reveal timeline (under the room
  -- lock, so concurrent final "ready" requests establish exactly one reveal_at).
  if v_room.phase in ('ROUND_LOCKED', 'RESULTS_READY')
     and public.all_required_ready(v_round.id, 'pre_results') then
    update public.rounds
       set reveal_at = now()
     where id = v_round.id and reveal_at is null
     returning * into v_round;
    select * into v_round from public.rounds where id = v_room.current_round_id;
    update public.rooms set phase = 'REVEAL' where id = p_room_id returning * into v_room;
  end if;

  -- REVEAL → RESULTS once the reveal sequence has played out (server time).
  if v_room.phase = 'REVEAL'
     and v_round.reveal_at is not null
     and now() >= v_round.reveal_at + public.reveal_duration() then
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
  v_now timestamptz;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);
  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('game_finished');
  end if;
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;
  if not exists (select 1 from public.answer_sheets where round_id = p_round_id and player_id = v_uid) then
    perform public.raise_app_error('not_participant');
  end if;
  perform public.advance_game(p_room_id);
  select * into v_round from public.rounds where id = p_round_id;
  -- Concurrent STOP, timeout and retries have no further effect.
  if v_round.locked_at is not null then return; end if;
  v_now := clock_timestamp();
  if v_round.started_at is null or v_now < v_round.started_at then
    perform public.raise_app_error('wrong_phase');
  end if;
  update public.rounds
     set locked_at = least(v_now, ends_at),
         lock_reason = case when v_now >= ends_at then 'timeout' else 'stop' end::public.round_lock_reason
   where id = p_round_id and locked_at is null;
  update public.rooms set phase = 'RESULTS_READY' where id = p_room_id;
  -- Nobody is marked READY here: pre_results is an independent check.
end;
$$;

drop function public.report_visibility(uuid, uuid, boolean, boolean);
create or replace function public.report_visibility(
  p_room_id uuid,
  p_round_id uuid,
  p_visible boolean,
  p_unloading boolean default false,
  p_answers jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_round public.rounds;
  v_sheet public.answer_sheets;
  v_event public.visibility_events;
  v_now timestamptz := now();
  v_cap timestamptz;
  v_end timestamptz;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);
  v_now := clock_timestamp();

  if v_room.phase = 'FINISHED' then
    perform public.raise_app_error('game_finished');
  end if;

  select * into v_round from public.rounds where id = p_round_id and room_id = p_room_id;
  if not found then
    perform public.raise_app_error('round_not_active');
  end if;

  select * into v_sheet
    from public.answer_sheets
   where round_id = p_round_id and player_id = v_uid;
  if not found then
    perform public.raise_app_error('not_participant');
  end if;

  if coalesce(p_visible, true) then
    -- RETURN: harmless when nothing is open (no history is invented).
    select * into v_event
      from public.visibility_events
     where round_id = p_round_id and player_id = v_uid and returned_at is null
     for update;
    if not found then
      return jsonb_build_object('state', 'visible', 'event', null);
    end if;

    v_cap := public.visibility_cap(v_round, v_sheet);
    v_end := greatest(v_event.away_at, least(v_now, v_cap));
    update public.visibility_events
       set returned_at = v_end,
           ended_by = case
                        when v_now < v_cap then 'returned'
                        when v_sheet.submitted_at is not null and v_sheet.submitted_at = v_cap
                          then 'answers_locked'
                        else 'round_ended'
                      end::public.visibility_end_reason
     where id = v_event.id
     returning * into v_event;

    return jsonb_build_object(
      'state', 'visible',
      'event', jsonb_build_object(
        'away_at', v_event.away_at,
        'returned_at', v_event.returned_at,
        'duration_ms', floor(extract(epoch from v_event.returned_at - v_event.away_at) * 1000)
      ));
  end if;

  -- AWAY: only during the caller's own effective PLAYING window of the current round.
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;
  if v_round.started_at is null or v_now < v_round.started_at then
    perform public.raise_app_error('wrong_phase');
  end if;
  if v_round.locked_at is not null or v_now >= v_round.ends_at
     or v_sheet.submitted_at is not null then
    return jsonb_build_object('state', 'locked', 'event', null);
  end if;
  -- Persist the last local snapshot and lock it in the same room transaction.
  if p_answers is not null then
    perform public.save_answers(p_room_id, p_round_id, p_answers);
  end if;

  insert into public.visibility_events (round_id, player_id, room_id, source, away_at)
  values (p_round_id, v_uid, p_room_id,
          case when p_unloading then 'unload' else 'visibility' end::public.visibility_source,
          v_now)
  on conflict (round_id, player_id) where returned_at is null do nothing
  returning * into v_event;

  if v_event.id is null then
    select * into v_event
      from public.visibility_events
     where round_id = p_round_id and player_id = v_uid and returned_at is null;
  end if;

  update public.answer_sheets
     set submitted_at = clock_timestamp(), lock_reason = 'tab_exit'
   where round_id = p_round_id and player_id = v_uid and submitted_at is null;

  return jsonb_build_object(
    'state', 'locked',
    'event', jsonb_build_object('away_at', v_event.away_at, 'returned_at', null));
end;
$$;

revoke all on function public.report_visibility(uuid, uuid, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.report_visibility(uuid, uuid, boolean, boolean, jsonb) to authenticated;
notify pgrst, 'reload schema';
