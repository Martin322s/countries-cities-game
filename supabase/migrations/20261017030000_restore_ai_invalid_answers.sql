create or replace function public.set_answer_invalidated(
  p_room_id uuid,
  p_round_id uuid,
  p_player_id uuid,
  p_category text,
  p_invalidated boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.assert_authenticated();
  v_room public.rooms;
  v_answer public.answers;
  v_ai_invalid boolean;
begin
  v_room := public.lock_room_for_member(p_room_id, v_uid);

  if v_room.host_player_id <> v_uid then
    perform public.raise_app_error('not_host');
  end if;
  if v_room.current_round_id is distinct from p_round_id then
    perform public.raise_app_error('round_not_active');
  end if;
  if v_room.phase not in ('REVEAL', 'RESULTS') then
    perform public.raise_app_error('results_not_available');
  end if;
  if p_invalidated is null then
    perform public.raise_app_error('invalid_answers');
  end if;
  if p_category is null or p_category not in ('country', 'city', 'village', 'animal', 'plant', 'object', 'name') then
    perform public.raise_app_error('invalid_category');
  end if;

  select * into v_answer
    from public.answers
   where round_id = p_round_id
     and player_id = p_player_id
     and category = p_category::public.answer_category
   for update;
  if not found or v_answer.normalized_value = '' then
    perform public.raise_app_error('answer_empty');
  end if;

  v_ai_invalid := v_answer.validation_status = 'INVALID';
  if (v_answer.invalidated_at is not null or v_ai_invalid) = p_invalidated then
    return;
  end if;

  update public.answers
     set invalidated_at = case when p_invalidated then now() end,
         invalidated_by = case when p_invalidated then v_uid end,
         validation_status = case
           when not p_invalidated and validation_status = 'INVALID' then 'VALID'
           else validation_status
         end,
         validation_reason = case
           when not p_invalidated and validation_status = 'INVALID' then null
           else validation_reason
         end,
         validation_suggestion = case
           when not p_invalidated and validation_status = 'INVALID' then null
           else validation_suggestion
         end,
         validated_at = case
           when not p_invalidated and validation_status = 'INVALID' then clock_timestamp()
           else validated_at
         end
   where round_id = p_round_id
     and player_id = p_player_id
     and category = p_category::public.answer_category;

  insert into public.answer_invalidation_events (room_id, round_id, player_id, category, action, actor_id)
  values (
    p_room_id, p_round_id, p_player_id, p_category::public.answer_category,
    case when p_invalidated then 'invalidate'::public.invalidation_action else 'restore'::public.invalidation_action end,
    v_uid
  );

  update public.rooms set results_revision = results_revision + 1 where id = p_room_id;
end;
$$;

grant execute on function public.set_answer_invalidated(uuid, uuid, uuid, text, boolean) to authenticated;
