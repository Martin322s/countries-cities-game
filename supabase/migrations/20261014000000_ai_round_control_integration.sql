-- Integrate the AI phase AFTER READY; only a trusted worker can publish decisions.
alter table public.rounds
  add column validation_started_at timestamptz,
  add column validation_finished_at timestamptz,
  add column validation_claim uuid,
  add column validation_claimed_at timestamptz,
  add column validation_attempts integer not null default 0 check (validation_attempts between 0 and 3);

alter table public.round_validations enable row level security;
revoke all on public.round_validations from public, anon, authenticated;
grant select on public.round_validations to authenticated;
grant all on public.round_validations to service_role;
grant usage, select on sequence public.round_validations_id_seq to service_role;
create policy "members read revealed validations" on public.round_validations
  for select to authenticated using (
    public.is_room_member(room_id) and public.round_answers_revealed(round_id)
  );
alter table public.round_validations alter column model set default 'gpt-4.1-mini';

revoke all on function public.set_ai_validation_pending(uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_ai_validation(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

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
    update public.rounds set validation_started_at = clock_timestamp() where id = v_round.id;
    update public.rooms set phase = 'AI_VALIDATING' where id = p_room_id returning * into v_room;
  end if;

  -- Bound failure even when the worker crashes or no API key is configured.
  if v_room.phase = 'AI_VALIDATING'
     and v_round.validation_started_at < clock_timestamp() - interval '180 seconds' then
    update public.answers set validation_status = 'INVALID', validation_reason = 'AMBIGUOUS',
           validation_suggestion = null, validated_at = clock_timestamp()
     where round_id = v_round.id and validation_status = 'PENDING';
    insert into public.round_validations
      (room_id, round_id, player_id, category, answer, validation_status, validation_reason, model)
    select p_room_id, round_id, player_id, category, raw_value, validation_status, validation_reason, 'validation-timeout'
      from public.answers where round_id = v_round.id
    on conflict (round_id, player_id, category) do nothing;
    update public.rounds set validation_finished_at = clock_timestamp(), reveal_at = clock_timestamp(),
           validation_claim = null, validation_claimed_at = null
     where id = v_round.id returning * into v_round;
    update public.rooms set phase = 'REVEAL' where id = p_room_id returning * into v_room;
  end if;

  -- REVEAL → RESULTS once the reveal sequence has played out (server time).
  if v_room.phase = 'REVEAL'
     and v_round.reveal_at is not null
     and clock_timestamp() >= v_round.reveal_at + public.reveal_duration() then
    update public.rooms set phase = 'RESULTS' where id = p_room_id;
  end if;
end;
$$;
