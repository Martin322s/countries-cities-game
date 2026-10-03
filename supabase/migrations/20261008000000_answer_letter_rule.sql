-- =============================================================================
-- Answers must start with the round's letter
--
-- A non-empty answer whose first character (after normalization: NFC, trimmed,
-- lowercased) is not the round's letter scores 0 automatically. It gets its own
-- state, 'wrong_letter', and — like empty and host-invalidated answers — is left out
-- of duplicate grouping, so it never turns someone else's answer into a duplicate.
--
-- Scoring order per category (authoritative, supersedes migration 4):
--   1. take the submitted answer          (missing row = empty)
--   2. empty / non-empty                   (normalized value '' = empty → 0)
--   3. wrong first letter                  (wrong_letter → 0, excluded from grouping)
--   4. drop host-invalidated answers       (invalid → 0, excluded from grouping)
--   5. group the remaining valid answers   (answers.normalized_value)
--   6. group size > 1 → every member 0     (duplicate)
--   7. group size = 1 → 1                  (unique)
--
-- Mirrors classifyCategoryAnswers / startsWithLetter in src/domain.
-- Grants are unchanged (CREATE OR REPLACE keeps them; round_cells stays internal).
-- =============================================================================

create or replace function public.round_cells(p_round_id uuid)
returns table (
  player_id uuid,
  category public.answer_category,
  answer text,
  state text,
  points integer,
  duplicate_count integer
)
language sql
stable
set search_path = ''
as $$
  with round_letter as (
    select lower(r.letter collate "und-x-icu") as letter
      from public.rounds r
     where r.id = p_round_id
  ),
  cells as (
    select s.player_id,
           c.category,
           coalesce(a.raw_value, '') as answer,
           coalesce(a.normalized_value, '') as normalized,
           a.invalidated_at is not null as invalidated
      from public.answer_sheets s
     cross join unnest(enum_range(null::public.answer_category)) as c (category)
      left join public.answers a
        on a.round_id = s.round_id and a.player_id = s.player_id and a.category = c.category
     where s.round_id = p_round_id
  ),
  classified as (
    select cells.*,
           case
             when normalized = '' then 'empty'
             when left(normalized, 1) is distinct from (select letter from round_letter)
               then 'wrong_letter'
             when invalidated then 'invalid'
           end as excluded_state
      from cells
  ),
  groups as (
    select g.category, g.normalized, count(*)::integer as size
      from classified g
     where g.excluded_state is null
     group by g.category, g.normalized
  )
  select k.player_id,
         k.category,
         k.answer,
         coalesce(k.excluded_state, case when g.size > 1 then 'duplicate' else 'unique' end),
         case when k.excluded_state is null and g.size = 1 then 1 else 0 end,
         coalesce(g.size, 0)
    from classified k
    left join groups g on g.category = k.category and g.normalized = k.normalized;
$$;
