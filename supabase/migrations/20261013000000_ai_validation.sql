-- Stage 2: AI validation for round answers.
-- The validation phase is server-authoritative and follows the round lock / result
-- publication flow. The UI only renders the current phase and the result data.

alter type public.game_phase add value if not exists 'AI_VALIDATING';

create type public.answer_validation_status as enum ('PENDING', 'VALID', 'INVALID');
create type public.answer_validation_reason as enum (
  'WRONG_LETTER',
  'MISSPELLING',
  'DOES_NOT_EXIST',
  'WRONG_CATEGORY',
  'AMBIGUOUS'
);

alter table public.answers
  add column if not exists validation_status public.answer_validation_status not null default 'PENDING',
  add column if not exists validation_reason public.answer_validation_reason,
  add column if not exists validation_suggestion text,
  add column if not exists validated_at timestamptz;

create table if not exists public.round_validations (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  round_id uuid not null,
  player_id uuid not null,
  category public.answer_category not null,
  answer text not null,
  validation_status public.answer_validation_status not null,
  validation_reason public.answer_validation_reason,
  validation_suggestion text,
  model text not null default 'gpt-6.1-sol',
  created_at timestamptz not null default now(),
  unique (round_id, player_id, category),
  foreign key (round_id, player_id, category)
    references public.answers (round_id, player_id, category) on delete cascade
);

create index if not exists round_validations_room_round_idx
  on public.round_validations (room_id, round_id, created_at);

-- Reuse the existing room phase update logic: validation is a server-side step
-- before results are exposed, and it cannot be skipped by the client.
create or replace function public.set_ai_validation_pending(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms
     set phase = 'AI_VALIDATING'
   where id = p_room_id
     and phase = 'RESULTS_READY';
end;
$$;

create or replace function public.complete_ai_validation(
  p_room_id uuid,
  p_round_id uuid,
  p_results jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'invalid_validation_payload';
  end if;

  for v_item in select value from jsonb_array_elements(p_results) loop
    update public.answers a
       set validation_status = coalesce((v_item ->> 'status')::public.answer_validation_status, 'INVALID'),
           validation_reason = case when v_item ->> 'reason' is null then null else (v_item ->> 'reason')::public.answer_validation_reason end,
           validation_suggestion = nullif(v_item ->> 'suggestion', ''),
           validated_at = now()
     where a.round_id = p_round_id
       and a.player_id = (v_item ->> 'player_id')::uuid
       and a.category = (v_item ->> 'category')::public.answer_category;

    insert into public.round_validations (
      room_id,
      round_id,
      player_id,
      category,
      answer,
      validation_status,
      validation_reason,
      validation_suggestion,
      model
    )
    select p_room_id,
           p_round_id,
           (v_item ->> 'player_id')::uuid,
           (v_item ->> 'category')::public.answer_category,
           v_item ->> 'value',
           coalesce((v_item ->> 'status')::public.answer_validation_status, 'INVALID'),
           case when v_item ->> 'reason' is null then null else (v_item ->> 'reason')::public.answer_validation_reason end,
           nullif(v_item ->> 'suggestion', ''),
           coalesce(v_item ->> 'model', 'gpt-6.1-sol')
    on conflict (round_id, player_id, category)
    do update set
      answer = excluded.answer,
      validation_status = excluded.validation_status,
      validation_reason = excluded.validation_reason,
      validation_suggestion = excluded.validation_suggestion,
      model = excluded.model,
      created_at = now();
  end loop;

  update public.rooms
     set phase = 'RESULTS'
   where id = p_room_id
     and phase = 'AI_VALIDATING';
end;
$$;
