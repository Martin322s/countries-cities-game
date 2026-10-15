-- =============================================================================
-- Fair-play visibility monitoring (informational only)
--
-- While a round is effectively PLAYING, a participant's client reports when the game
-- page becomes hidden ("away") and visible again ("return"). The server decides who,
-- which round and when: identity is auth.uid(), the round must be the room's current
-- round, and every timestamp is the server's now() — clamped to the end of the
-- player's answering window (ends_at, the round lock or their own answer lock).
--
-- Nothing here ever touches scoring, answers, ready states or timing. The data only
-- tells the group that the page was hidden and for how long — never why, and never
-- anything about what else was on screen.
-- =============================================================================

-- 'unload': the page was being unloaded (refresh, close, navigation). Clients use a
-- longer display grace for these, so a quick refresh is not shown as an absence.
alter type public.visibility_source add value if not exists 'unload';

create type public.visibility_end_reason as enum (
  'returned',       -- the page became visible again
  'round_ended',    -- the answering window closed while away (ends_at / round lock)
  'answers_locked'  -- the player's own sheet was locked while away (e.g. left the room)
);

-- -----------------------------------------------------------------------------
-- visibility_events: one row per away interval (table existed since migration 1, unused)
-- -----------------------------------------------------------------------------
alter table public.visibility_events rename column left_at to away_at;

alter table public.visibility_events
  add column room_id uuid references public.rooms (id) on delete cascade,
  add column ended_by public.visibility_end_reason,
  add column created_at timestamptz not null default now();

update public.visibility_events e
   set room_id = r.room_id
  from public.rounds r
 where r.id = e.round_id;

alter table public.visibility_events
  alter column room_id set not null,
  alter column source set default 'visibility',
  add constraint visibility_events_closed_consistent
    check ((returned_at is null) = (ended_by is null)),
  -- Only round participants can have events.
  add constraint visibility_events_participant_fk
    foreign key (round_id, player_id)
    references public.answer_sheets (round_id, player_id) on delete cascade;

-- Never more than one open interval per player and round.
create unique index visibility_events_one_open
  on public.visibility_events (round_id, player_id)
  where returned_at is null;

create index visibility_events_room_idx on public.visibility_events (room_id);

-- A closed interval is history: it can never change again (even with privileged
-- access). An open interval may only be closed — identity and away_at are fixed.
create function public.visibility_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.returned_at is not null then
    raise exception 'visibility events are immutable once closed' using errcode = '23514';
  end if;
  if new.id <> old.id or new.round_id <> old.round_id or new.player_id <> old.player_id
     or new.room_id <> old.room_id or new.away_at <> old.away_at or new.source <> old.source
     or new.created_at <> old.created_at then
    raise exception 'visibility events can only be closed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger visibility_events_immutable
  before update on public.visibility_events
  for each row execute function public.visibility_events_guard();

-- -----------------------------------------------------------------------------
-- Finalization: open intervals never outlive the answering window
-- -----------------------------------------------------------------------------

-- The round locked (timeout or everyone ready): close every open interval at the lock.
create function public.close_visibility_on_round_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.visibility_events
     set returned_at = greatest(away_at, least(new.locked_at, new.ends_at)),
         ended_by = 'round_ended'
   where round_id = new.id and returned_at is null;
  return null;
end;
$$;

create trigger rounds_close_visibility
  after update of locked_at on public.rounds
  for each row
  when (old.locked_at is null and new.locked_at is not null)
  execute function public.close_visibility_on_round_lock();

-- A player's own sheet locked (READY, or leaving mid-round): close their interval.
create function public.close_visibility_on_sheet_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.visibility_events
     set returned_at = greatest(away_at, new.submitted_at),
         ended_by = 'answers_locked'
   where round_id = new.round_id and player_id = new.player_id and returned_at is null;
  return null;
end;
$$;

create trigger answer_sheets_close_visibility
  after update of submitted_at on public.answer_sheets
  for each row
  when (old.submitted_at is null and new.submitted_at is not null)
  execute function public.close_visibility_on_sheet_lock();

-- End of a player's answering window in a round: the earliest of ends_at, the round
-- lock and their own answer lock. Null while the round has not started.
create function public.visibility_cap(p_round public.rounds, p_sheet public.answer_sheets)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select least(p_round.ends_at,
               coalesce(p_round.locked_at, 'infinity'::timestamptz),
               coalesce(p_sheet.submitted_at, 'infinity'::timestamptz));
$$;

-- -----------------------------------------------------------------------------
-- report_visibility: the only write path
-- -----------------------------------------------------------------------------
-- p_visible = false → the caller's game page became hidden: open an interval at now().
-- p_visible = true  → it is visible again: close the open interval (if any) at now(),
--                     clamped to the caller's answering window.
-- p_unloading marks an away caused by the page unloading (refresh/close), so clients
-- can apply a longer display grace. Repeated reports are idempotent.
create function public.report_visibility(
  p_room_id uuid,
  p_round_id uuid,
  p_visible boolean,
  p_unloading boolean default false
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
  if v_round.locked_at is not null or v_now >= v_round.ends_at then
    perform public.raise_app_error('round_over');
  end if;
  if v_sheet.submitted_at is not null then
    perform public.raise_app_error('answers_locked');
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

  return jsonb_build_object(
    'state', 'away',
    'event', jsonb_build_object('away_at', v_event.away_at, 'returned_at', null));
end;
$$;

-- -----------------------------------------------------------------------------
-- get_round_activity: read model for one round (any round of the caller's room)
-- -----------------------------------------------------------------------------
-- Every interval of the round in away order. Open intervals whose answering window has
-- already ended are reported closed at that moment, so a player who stays away until
-- the deadline is never shown as away for longer than the round allowed — even before
-- any request finalized the row. cap_at tells clients where a still-open interval stops.
create function public.get_round_activity(p_room_id uuid, p_round_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_room_member(p_room_id) then
    perform public.raise_app_error('not_member');
  end if;
  select * into v_round from public.rounds where id = p_round_id and room_id = p_room_id;
  if not found then
    perform public.raise_app_error('round_not_active');
  end if;

  return jsonb_build_object(
    'round_id', v_round.id,
    'server_now', v_now,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id,
               'player_id', e.player_id,
               'source', e.source,
               'away_at', e.away_at,
               'returned_at', case
                                when e.returned_at is not null then e.returned_at
                                when cap.at <= v_now then greatest(e.away_at, cap.at)
                              end,
               'ended_by', case
                             when e.returned_at is not null then e.ended_by::text
                             when cap.at <= v_now then
                               case when s.submitted_at = cap.at then 'answers_locked'
                                    else 'round_ended' end
                           end,
               'cap_at', cap.at
             ) order by e.away_at, e.id)
        from public.visibility_events e
        join public.answer_sheets s on s.round_id = e.round_id and s.player_id = e.player_id
        cross join lateral (select public.visibility_cap(v_round, s) as at) cap
       where e.round_id = v_round.id
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Realtime: status rows only (who, when) — the table holds nothing else
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.visibility_events;

-- -----------------------------------------------------------------------------
-- Privileges (RLS read policy "members read visibility events" exists since migration 1;
-- clients have no write privileges on any table)
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_round_member(uuid) to authenticated;
grant execute on function public.can_access_room_topic(text) to authenticated;
grant execute on function public.round_answers_revealed(uuid) to authenticated;

grant execute on function public.create_room(text, integer) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.set_round_ready(uuid) to authenticated;
grant execute on function public.save_answers(uuid, uuid, jsonb) to authenticated;
grant execute on function public.lock_answers(uuid, uuid) to authenticated;
grant execute on function public.set_results_ready(uuid) to authenticated;
grant execute on function public.get_game_state(uuid) to authenticated;
grant execute on function public.get_round_results(uuid, uuid) to authenticated;
grant execute on function public.set_answer_invalidated(uuid, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.start_next_round(uuid) to authenticated;
grant execute on function public.finish_game(uuid) to authenticated;
grant execute on function public.get_game_summary(uuid) to authenticated;
grant execute on function public.report_visibility(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.get_round_activity(uuid, uuid) to authenticated;
