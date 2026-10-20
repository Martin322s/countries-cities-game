# Supabase backend

All authority over rooms lives here: schema, constraints, RLS, Realtime authorization
and the RPC functions the client calls.

| Migration                              | Contents                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261002000000_initial_schema`        | Tables, enums, constraints, member read-only RLS                                                                                                                                                                                                                 |
| `20261002010000_rooms_lobby`           | Name keys + uniqueness, room RPCs, maintenance, privileges, Realtime publication + channel RLS                                                                                                                                                                   |
| `20261003000000_gameplay_rounds`       | Round timing/lock columns, participant snapshot, ready stages, gameplay RPCs, answer privacy, lazy game advancement                                                                                                                                              |
| `20261004000000_round_results`         | `reveal_at`, derived scoring (`round_cells`), results API, host invalidation + audit trail, `results_revision`                                                                                                                                                   |
| `20261006000000_visibility_monitoring` | Fair-play away intervals: `report_visibility`, `get_round_activity`, one-open-interval index, finalization triggers, immutability, realtime                                                                                                                      |
| `20261007000000_production_hardening`  | Rate limiting (PostgREST pre-request hook, `private` schema), 16 KB request limit, size guards before normalization, room-code guessing limit (`join_room` → NULL for unknown codes), retention cleanup + `pg_cron`, cascade indexes, faster `standings_through` |
| `20261005000000_multi_round_game`      | Next round, snapshot/sequence guards, standings "as of" a round, progress + history in game state, finish, summary                                                                                                                                               |

## Local development

Requires Docker. The CLI comes from `devDependencies`.

```bash
npm run db:start     # supabase start (minus services we don't use) + applies migrations
npm run db:reset     # rebuild the local DB from migrations
npm run db:test      # pgTAP tests in supabase/tests/database
npm run db:lint      # plpgsql_check over public functions
npm run db:types     # regenerate src/shared/lib/database.types.ts
npm run test:integration   # app-level tests against the running stack (concurrency, RLS, realtime)
npx supabase stop
```

`supabase/config.toml` enables anonymous sign-ins. For local development and the
integration tests only, it also raises the anonymous sign-in rate limit to 1000 per hour.

## Hosted project setup (manual)

1. **Authentication → Sign In / Providers → Allow anonymous sign-ins: ON.**
2. **Realtime → Settings:** turn **off** "Allow public access", so channels must be private
   and authorized by RLS. The app only uses private channels.
3. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
4. Copy **Project URL** and the **publishable key** into `.env.local` (never the secret key).
5. Recommended before launch: enable **CAPTCHA** (Auth → Attack Protection) and review
   **Rate Limits → anonymous sign-ins**.

## Data model (rooms & lobby)

`rooms`
: `code` (unique, 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), `capacity` (2–15,
immutable), `phase` (`game_phase` enum), `host_player_id` (a deferrable FK to a member
row: exactly one host, always a member).

`room_players`
: PK `(room_id, player_id)`, so there's one row per user per room, and rejoins reuse it.

- `display_name` (canonical) and `display_name_key` (ICU lowercase).
- Partial unique index on `(room_id, display_name_key) WHERE left_at IS NULL`.
- `joined_at` sets the host-election order. `last_seen_at` is the server heartbeat.
- `left_at` / `left_reason` (`left` | `expired`) record departures.

## RPCs

Every RPC is `SECURITY DEFINER` with `search_path = ''`, uses `auth.uid()` as identity,
locks the room row first (lock order rooms → room_players), and raises expected failures
as `MESSAGE = <code>, HINT = 'app_error'`.

| Function                      | Validates                                                                                                                                                     | Error codes                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `create_room(name, capacity)` | signed in, name 1–20, capacity 2–15                                                                                                                           | `not_authenticated`, `invalid_display_name`, `invalid_capacity`, `room_code_unavailable`                                            |
| `join_room(code, name)`       | code format, room exists (unknown code → returns NULL, counted against the guessing limit), rejoin first, then phase = LOBBY, name, capacity, name uniqueness | `invalid_room_code`, `rate_limited`, `room_finished`, `game_in_progress`, `room_full`, `display_name_taken`, `invalid_display_name` |
| `leave_room(room_id)`         | caller is an active member                                                                                                                                    | `not_member`                                                                                                                        |
| `heartbeat(room_id)`          | caller is an active member                                                                                                                                    | `not_member`                                                                                                                        |

Internal (not executable by clients): `maintain_room`, `elect_room_host`,
`generate_room_code`, normalization and assertion helpers.

## Gameplay

| Function                                   | Validates                                                                                                       | Error codes                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `start_game(room_id)`                      | caller is host, phase LOBBY, ≥ 2 active players                                                                 | `not_host`, `game_already_started`, `not_enough_players`                                                                    |
| `set_round_ready(room_id)`                 | caller is a participant of the current round, phase ROUND_WAITING                                               | `not_participant`, `wrong_phase`                                                                                            |
| `save_answers(room_id, round_id, answers)` | active member, current round, own unlocked sheet, `started_at ≤ now() < ends_at`, known categories, ≤ 100 chars | `round_not_active`, `answers_locked`, `wrong_phase`, `round_over`, `invalid_category`, `invalid_answers`, `answer_too_long` |
| `lock_answers(room_id, round_id)`          | participant, round started; idempotent, no-op after the round ended                                             | `not_participant`, `round_not_active`, `wrong_phase`                                                                        |
| `set_results_ready(room_id)`               | participant, phase RESULTS_READY                                                                                | `not_participant`, `wrong_phase`                                                                                            |
| `get_game_state(room_id)`                  | active member (read-only)                                                                                       | `not_member`                                                                                                                |

Internal: `advance_game` (all due transitions, under the room lock),
`all_required_ready`, `all_answers_locked`, `confirm_ready_stage`,
`lock_room_for_member`, `clean_answer`, `normalize_answer`, `eligible_letters`.

**Participant snapshot.** `answer_sheets` has one row per round participant, created with
the round. `ready_checks` rows must reference a participant (FK) and are keyed by
`(round_id, player_id, stage)`.

**Timing.** Both are set when the letter is drawn:
`started_at = countdown_at + countdown_duration()` (3 s), and
`ends_at = started_at + round_duration()` (120 s). The partial unique index
`rounds_one_open_round_per_room` allows a single open round per room.

**advance_game** runs from every room RPC, including each heartbeat:

1. `ROUND_WAITING` → `COUNTDOWN` when `all_required_ready(pre_round)`. Draws a letter not
   used in this room yet (a round only exists while one remains — see `start_next_round`).
2. `COUNTDOWN` → `PLAYING` once `now() ≥ started_at`. `used_letters` is extended here.
3. `PLAYING` → `RESULTS_READY` when `now() ≥ ends_at` (`timeout`, `locked_at = ends_at`) or
   `all_answers_locked` (`all_ready`).
4. `RESULTS_READY` → `REVEAL` when `all_required_ready(pre_results)`. This sets
   `rounds.reveal_at = now()` exactly once.
5. `REVEAL` → `RESULTS` once `now() ≥ reveal_at + reveal_duration()` (11 s).

## Results

| Function                                                                      | Validates                                                                                               | Error codes                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `get_round_results(room_id, round_id?)`                                       | active member; round revealed (`REVEAL`/`RESULTS`/`FINISHED` or a later round)                          | `not_member`, `round_not_active`, `results_not_available`                                   |
| `set_answer_invalidated(room_id, round_id, player_id, category, invalidated)` | current host (after maintenance), current round, phase `REVEAL`/`RESULTS`, non-empty answer; idempotent | `not_host`, `round_not_active`, `results_not_available`, `invalid_category`, `answer_empty` |

- **Scoring is derived:** `round_cells(round_id)` returns state, points and duplicate group
  size for every participant × category, from `answers` + `invalidated_at`. There are no
  score columns.
- **Standings** (`standings_through(room, round_number)`) sum `round_cells` over the revealed
  rounds **up to** the given round, with `rounds_played`. `get_round_results` returns them as of
  the requested round (plus `round.is_current`), so history shows the leaderboard as it was.
- **Frozen history:** invalidation is accepted only for the current round; once round N+1
  exists, round N returns `round_not_active`.
- **Invalidation state** lives on `answers.invalidated_at/by`. Each real change appends a row
  to `answer_invalidation_events` (RLS on, no grants: an internal audit trail only).
- **Realtime:** each change bumps `rooms.results_revision`, and clients refetch the results.

## Multi-round game

| Function                    | Validates                                                                                                | Error codes                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `start_next_round(room_id)` | current host, phase RESULTS, letters left, ≥ 2 eligible players; creates round N+1 + snapshot, no letter | `not_host`, `game_finished`, `round_already_started`, `wrong_phase`, `no_letters_left`, `not_enough_players` |
| `finish_game(room_id)`      | current host, phase RESULTS, all letters used; no-op if already FINISHED                                 | `not_host`, `wrong_phase`, `letters_remaining`                                                               |
| `get_game_summary(room_id)` | active member (read-only)                                                                                | `not_member`                                                                                                 |

- **Eligible players** (`eligible_round_players`): `left_at is null` and `last_seen_at` within
  `member_stale_after()` (45 s), in join order. They become the new round's `answer_sheets`.
- **Guards in the database:** trigger `rounds_sequential_numbers` (round_number = max + 1);
  trigger `answer_sheets_snapshot_immutable` (sheets can only be inserted in the transaction
  that created the round, and their ids never change) — both hold even for privileged writes.
- `total_rounds()` = number of eligible letters (28). `rooms.finished_at` records the end.
- `get_game_state` adds `progress { total_rounds, letters_used, rounds_completed,
is_final_round, eligible_players }` and `revealed_rounds [{ id, number, letter }]`.
- **FINISHED is terminal:** `set_round_ready`, `set_results_ready` and `start_next_round` return
  `game_finished`; saving and invalidating fail as for any closed round. Reads keep working.

## Fair-play visibility

| Function                                                   | Validates                                                                                                                                             | Error codes                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `report_visibility(room_id, round_id, visible, unloading)` | active member + participant of that round; away: current round, `started_at ≤ now() < ends_at`, round and own sheet unlocked; return: always harmless | `not_member`, `not_participant`, `round_not_active`, `wrong_phase`, `round_over`, `answers_locked`, `game_finished` |
| `get_round_activity(room_id, round_id)`                    | active member (read-only), a round of that room                                                                                                       | `not_member`, `round_not_active`                                                                                    |

- `visibility_events` (unused since migration 1): `away_at` (renamed from `left_at`),
  `returned_at`, `ended_by` (`returned` / `round_ended` / `answers_locked`), `source`
  (`visibility` / `unload`), `room_id`, FK to the round participant. Nothing else — no URLs,
  titles or device data.
- Partial unique index `visibility_events_one_open`: one open interval per player and round.
- `visibility_cap(round, sheet)` = least(`ends_at`, round lock, own answer lock): no interval
  ends after it. Triggers close open intervals when `rounds.locked_at` or
  `answer_sheets.submitted_at` is set. `visibility_events_immutable` forbids changing a closed
  row, and anything but the end of an open one — even as postgres.
- All times are the server's `now()`; the client sends only `visible` and `unloading`.
- Published to Realtime (who/when only); the existing member-only SELECT policy applies.

## Room maintenance

`maintain_room(room_id)` runs inside `join_room` and `heartbeat`. It's idempotent, so
running it often is safe.

1. In LOBBY **only**, members silent for more than `lobby_seat_expiry()` (2 min) lose their
   seat. Participants of a running game are never expired.
2. If the host has left, the role passes to the best candidate. If the host is merely
   stale (more than `member_stale_after()`, 45 s), it passes only to a **connected**
   candidate.

Every connected client sends a heartbeat every 15 s, so maintenance happens continuously
while anyone is in the room, without `pg_cron`. A scheduled sweep would only matter for
rooms where nobody is left. Cleaning those up is future work.

## RLS model

| Table / object                                                 | Policy                                                                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rooms`                                                        | SELECT if caller is an active member                                                                                                                     |
| `room_players`                                                 | SELECT rows of rooms the caller is an active member of                                                                                                   |
| `rounds`, `ready_checks`, `answer_sheets`, `visibility_events` | SELECT for active members of the round's room (visibility rows hold only who/when)                                                                       |
| `answers`                                                      | own answers always; others only once the round is revealed (`REVEAL`/`RESULTS`/`FINISHED` or a later round) — never while playing, not even for the host |
| `answer_invalidation_events`                                   | no client access at all (audit trail)                                                                                                                    |
| `rounds.letter`                                                | not selectable by clients at all (column privilege); revealed by `get_game_state` at `started_at`                                                        |
| `realtime.messages`                                            | SELECT/INSERT on topic `room:<uuid>` only for active members (private channels)                                                                          |

There are no write policies. Table write privileges are revoked from `anon` and
`authenticated`, and `anon` has no table access at all. Default privileges are adjusted
so future functions and tables start private.

## Realtime

- **Publication:** `rooms`, `room_players`, `answer_sheets`, `ready_checks` and
  `visibility_events` are in `supabase_realtime` (status only: who/when, never content). `answers` and `rounds` are deliberately **not**
  published, so answer text and the hidden letter never travel over Realtime. Postgres Changes
  delivery respects each subscriber's RLS.
- **Channel:** one private channel per room, `room:<room_id>`. It carries Postgres
  Changes, plus Presence keyed by player id.
- **Presence is cosmetic.** A client chooses its own presence payload, so it only drives
  status dots. Authority (host grace period, seat expiry) comes from `last_seen_at`.

## Tests

- `supabase/tests/database/rooms.test.sql`: 55 pgTAP assertions for rooms and the lobby.
  They cover anon access, create validation, non-member invisibility, join, rejoin, names,
  forbidden writes, capacity, host migration, seat expiry, joinability and topic auth.
- `supabase/tests/database/gameplay.test.sql`: 97 pgTAP assertions for gameplay. They cover:
  - start rules: host only, ≥ 2 players, once, then no new players;
  - ready stages: idempotent and isolated per stage;
  - the letter draw: eligible, hidden until start, never repeated (27 letters pre-used);
  - the 3 s / 120 s timeline;
  - save validation and answer privacy, host included;
  - personal lock, early finish, timeout lock at `ends_at`;
  - stale-player rules, no lobby expiry mid-game;
  - leaving and rejoining mid-game, host migration without touching the round.
- `supabase/tests/database/results.test.sql`: 69 pgTAP assertions for results. They cover:
  - visibility before and after REVEAL, host included;
  - every scoring rule, including 3-way duplicates and "Стара Загора" ≠ "Стара-Загора";
  - invalidate / restore, idempotency and the audit trail;
  - empty and wrong-room targets, and rejection of a former host;
  - no direct writes, and REVEAL → RESULTS;
  - participants who left, and cumulative totals over a historical round.
- `supabase/tests/database/multi_round.test.sql`: 61 pgTAP assertions for the multi-round game:
  next-round rules (host / former host / phase / double call / letters / ≥ 2 eligible, stale
  and left players excluded), fresh ready state and empty answers per round, round-number
  sequence, frozen history, standings as of a round, no rows for absent players, rejoin
  between rounds, host migration in RESULTS, `finish_game` rules and idempotency, FINISHED
  restrictions, progress and summary.
- `supabase/tests/database/security_catalog.test.sql`: 14 schema-wide security invariants
  (search_path on every function, exact client RPC surface, no anon access, RLS everywhere,
  no client write privileges, read-only policies, private rate-limit tables, hidden letter,
  private audit trail, Realtime publication contents, channel authorization).
- `supabase/tests/database/hardening.test.sql`: 25 assertions — size guards, rate limits
  (per identity / per operation, autosave budget, reads not counted, payload limit, service
  role exempt), join-miss limit, retention cleanup (fresh/active/recent kept; abandoned and
  expired deleted with no orphans; a just-reconnected room kept; old anonymous users removed).
- `supabase/tests/database/visibility.test.sql`: 60 pgTAP assertions for fair-play visibility:
  rejected outside PLAYING (waiting, countdown, after the deadline, RESULTS, FINISHED, old
  rounds), own reports only (no player/timestamp parameters, non-members rejected), server
  `now()` as `away_at`, idempotent away, one open interval (unique index), return / repeated
  return / return without away, unload source, no events after READY, finalization when
  leaving and at the round lock, clamping to `ends_at` (read model and stored row), round
  isolation, immutable history, member-only reads, no direct writes, no effect on answers.
- `src/test/integration/*.integration.test.ts`: real clients through the public API.
  They are gated by `realtimeReady.ts`, which waits (bounded, with diagnostics) until Realtime
  delivers events after a reset. They cover:
  - concurrent last-seat and name races, and concurrent start / READY / lock / results-ready
    calls (exactly one transition);
  - the real 3 s countdown;
  - privacy through PostgREST;
  - that no answers are broadcast over Realtime;
  - Realtime delivery and private-channel authorization;
  - an accelerated **full 28-round game** (`fullGame.integration.test.ts`): real RPCs, only time
    simulated via a test-only local service client; 10 concurrent next-round calls, a player
    leaving and rejoining after the snapshot, snapshot immutability, letter exhaustion,
    finishing and FINISHED restrictions;
  - fair-play visibility (`visibility.integration.test.ts`): realtime delivery of away/return to
    members and not to outsiders, server timestamps, 10 concurrent away reports → one interval,
    the keepalive REST call the browser uses while hiding/unloading, and an absence finalized at
    the deadline without any return — with scoring unaffected.
