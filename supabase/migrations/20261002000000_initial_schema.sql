-- =============================================================================
-- Държави и градове — initial schema (foundation)
--
-- Security model
--   * Every player is a Supabase *anonymous* auth user; auth.uid() is the PlayerId.
--   * RLS is enabled on every table. This migration grants READ access to room
--     members only and grants NO direct INSERT/UPDATE/DELETE to clients.
--   * All writes (create/join room, ready, submit answers, phase transitions,
--     scoring, invalidation, host migration) will be implemented as
--     SECURITY DEFINER Postgres functions (RPC) that validate the caller,
--     the current phase and the server clock. See supabase/README.md.
--
-- Keep CHECK constraints in sync with src/domain (config.ts, alphabet.ts,
-- categories.ts, roomCode.ts, phases.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.game_phase as enum (
  'LOBBY',
  'ROUND_WAITING',
  'COUNTDOWN',
  'PLAYING',
  'ROUND_LOCKED',
  'RESULTS_READY',
  'REVEAL',
  'RESULTS',
  'FINISHED'
);

create type public.answer_category as enum (
  'country',
  'city',
  'village',
  'animal',
  'plant',
  'object',
  'name'
);

create type public.ready_stage as enum ('pre_round', 'pre_results');

create type public.visibility_source as enum ('visibility', 'blur', 'presence');

-- Eligible letters: the Bulgarian alphabet without Ъ and Ь (28 letters).
create function public.is_eligible_letter(letter text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select letter = any (array[
    'А','Б','В','Г','Д','Е','Ж','З','И','Й','К','Л','М','Н',
    'О','П','Р','С','Т','У','Ф','Х','Ц','Ч','Ш','Щ','Ю','Я'
  ]);
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique
                   check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$'),
  capacity         smallint not null check (capacity between 2 and 15),
  phase            public.game_phase not null default 'LOBBY',
  host_player_id   uuid not null,
  used_letters     text[] not null default '{}',
  current_round_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.room_players (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  player_id    uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  joined_at    timestamptz not null default now(),
  -- Server-side heartbeat; complements ephemeral Realtime Presence and is the
  -- source of truth for "permanently left" decisions (host migration, ready checks).
  last_seen_at timestamptz not null default now(),
  left_at      timestamptz,
  primary key (room_id, player_id)
);

create index room_players_player_id_idx on public.room_players (player_id);

-- The host must be a member of the room. Deferred so a room and its first
-- member can be inserted in the same transaction.
alter table public.rooms
  add constraint rooms_host_is_member
  foreign key (id, host_player_id)
  references public.room_players (room_id, player_id)
  deferrable initially deferred;

-- A round row is created when the room enters ROUND_WAITING. The letter and the
-- authoritative timer are assigned when the countdown starts.
create table public.rounds (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 28),
  letter       text check (letter is null or public.is_eligible_letter(letter)),
  started_at   timestamptz,
  ends_at      timestamptz,
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (room_id, round_number),
  unique (room_id, letter),
  check ((started_at is null) = (ends_at is null)),
  check (started_at is null or letter is not null),
  check (ends_at is null or ends_at > started_at),
  check (locked_at is null or started_at is not null)
);

alter table public.rooms
  add constraint rooms_current_round_fk
  foreign key (current_round_id) references public.rounds (id) on delete set null;

-- One sheet per player per round. submitted_at = the player pressed "ГОТОВ"
-- during PLAYING; from that moment their answers are immutable.
create table public.answer_sheets (
  round_id     uuid not null references public.rounds (id) on delete cascade,
  player_id    uuid not null references auth.users (id) on delete cascade,
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (round_id, player_id)
);

create table public.answers (
  round_id         uuid not null,
  player_id        uuid not null,
  category         public.answer_category not null,
  raw_value        text not null default '' check (char_length(raw_value) <= 100),
  -- Computed server-side with the same rules as src/domain/normalization.ts.
  normalized_value text not null default '',
  invalidated_at   timestamptz,
  invalidated_by   uuid references auth.users (id) on delete set null,
  primary key (round_id, player_id, category),
  foreign key (round_id, player_id)
    references public.answer_sheets (round_id, player_id) on delete cascade
);

create index answers_round_category_idx
  on public.answers (round_id, category, normalized_value);

-- Ready flags for the two ready-check stages. Rows are per round, so a new
-- round automatically starts with nobody ready.
create table public.ready_checks (
  round_id  uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade,
  stage     public.ready_stage not null,
  ready_at  timestamptz not null default now(),
  primary key (round_id, player_id, stage)
);

-- Informational anti-cheat log (never affects scoring automatically).
create table public.visibility_events (
  id          bigint generated always as identity primary key,
  round_id    uuid not null references public.rounds (id) on delete cascade,
  player_id   uuid not null references auth.users (id) on delete cascade,
  source      public.visibility_source not null,
  left_at     timestamptz not null,
  returned_at timestamptz,
  check (returned_at is null or returned_at >= left_at)
);

create index visibility_events_round_idx on public.visibility_events (round_id, player_id);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_touch_updated_at
  before update on public.rooms
  for each row execute function public.touch_updated_at();

create trigger answer_sheets_touch_updated_at
  before update on public.answer_sheets
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.rooms             enable row level security;
alter table public.room_players      enable row level security;
alter table public.rounds            enable row level security;
alter table public.answer_sheets     enable row level security;
alter table public.answers           enable row level security;
alter table public.ready_checks      enable row level security;
alter table public.visibility_events enable row level security;

-- Membership check used by policies. SECURITY DEFINER avoids recursive RLS
-- evaluation on room_players; it only ever answers about the calling user.
create function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_players rp
    where rp.room_id = target_room_id
      and rp.player_id = (select auth.uid())
      and rp.left_at is null
  );
$$;

create function public.is_round_member(target_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rounds r
    join public.room_players rp on rp.room_id = r.room_id
    where r.id = target_round_id
      and rp.player_id = (select auth.uid())
      and rp.left_at is null
  );
$$;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.is_round_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_round_member(uuid) to authenticated;

-- Read-only policies for members. There are intentionally NO write policies.
create policy "members read their room"
  on public.rooms for select to authenticated
  using (public.is_room_member(id));

create policy "members read room roster"
  on public.room_players for select to authenticated
  using (public.is_room_member(room_id));

create policy "members read rounds"
  on public.rounds for select to authenticated
  using (public.is_round_member(id));

create policy "members read answer sheet status"
  on public.answer_sheets for select to authenticated
  using (public.is_round_member(round_id));

-- Answers: your own at any time; everyone else's only after the round is locked,
-- so nobody can peek at other players' answers while PLAYING.
create policy "players read own answers"
  on public.answers for select to authenticated
  using (player_id = (select auth.uid()));

create policy "members read locked round answers"
  on public.answers for select to authenticated
  using (
    public.is_round_member(round_id)
    and exists (
      select 1 from public.rounds r
      where r.id = answers.round_id and r.locked_at is not null
    )
  );

create policy "members read ready checks"
  on public.ready_checks for select to authenticated
  using (public.is_round_member(round_id));

create policy "members read visibility events"
  on public.visibility_events for select to authenticated
  using (public.is_round_member(round_id));
