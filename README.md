# Държави и градове

A real-time multiplayer web version of the Bulgarian party game **"Държави и градове"**
("Countries and Cities") for 2–15 players. Each round a random Bulgarian letter is
drawn, and every player has 60 seconds to write a country, city, village, animal,
plant, object and name starting with that letter. Unique answers score.

The UI is in Bulgarian. Code, identifiers and technical docs are in English.

> **Release: Web v1.0** (`package.json` 1.0.0). Production hardening is done and verified
> locally; public launch still needs the external steps in
> [`docs/release-checklist.md`](docs/release-checklist.md) (hosted project, CAPTCHA keys,
> real devices, operator details).
>
> A complete 28-round game works end to end: lobby → ready check → server-drawn
> letter → synchronized countdown and 2-minute round → private autosaved answers →
> results-ready → synchronized, animated reveal → results with host invalidation and a
> cumulative leaderboard → "НОВ РУНД" … until all 28 letters are used → final standings
> ("КРАЙ НА ИГРАТА"). Previous rounds can be browsed read-only at any time. During a round
> the group sees when someone's game page was hidden (an informational fair-play signal).
> Synthesized sound effects, a small motion system and per-screen polish make it feel like a
> party game (see "Game feel").

## Tech stack

| Concern      | Choice                                                               |
| ------------ | -------------------------------------------------------------------- |
| UI           | React 19, TypeScript 6 (strict), Vite 8                              |
| Styling      | Tailwind CSS 4 (CSS-first `@theme` tokens)                           |
| Routing      | React Router 8                                                       |
| Server state | TanStack Query 5                                                     |
| Backend      | Supabase: Postgres + RLS, RPC functions, Realtime, anonymous auth    |
| Testing      | Vitest 5, React Testing Library, pgTAP, Supabase integration tests   |
| Quality      | ESLint 9 (typescript-eslint strict type-checked, jsx-a11y), Prettier |

**Version notes**

- TypeScript is pinned to `~6.0` because `typescript-eslint` doesn't support TS 7 yet.
- ESLint stays on 9 because `eslint-plugin-jsx-a11y` doesn't support ESLint 10 yet.

## Prerequisites

- Node.js ≥ 20.19 (developed on Node 24), npm ≥ 10
- Docker (Docker Desktop on Windows/macOS) for the local Supabase stack. The Supabase CLI
  is a dev dependency, so there's nothing to install globally.

## Getting started (local, full multiplayer)

```bash
npm install
npm run db:start            # starts local Supabase (Docker) and applies migrations
cp .env.example .env.local  # then paste the API URL + publishable key printed by db:start
npm run dev                 # http://localhost:5173
```

`npm run db:start` prints `API_URL` and `PUBLISHABLE_KEY`. For the local stack these are
`http://127.0.0.1:54321` and the local publishable key. Anonymous sign-ins are already
enabled in `supabase/config.toml`.

To try multiplayer on one machine, open the app in two different browser profiles, or a
normal window plus a private one. Each profile gets its own anonymous player.

## Scripts

| Command                    | What it does                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `npm run dev`              | Vite dev server                                                 |
| `npm run build`            | Type-check (`tsc -b`) + production build                        |
| `npm run preview`          | Serve the production build                                      |
| `npm run typecheck`        | TypeScript project references check                             |
| `npm run lint`             | ESLint (`lint:fix` to autofix)                                  |
| `npm run format`           | Prettier write (`format:check` to verify)                       |
| `npm test`                 | Unit/component tests (Vitest, no backend needed)                |
| `npm run check`            | typecheck + lint + format check + unit tests                    |
| `npm run test:integration` | Integration tests against the running local Supabase stack      |
| `npm run db:start`         | Start local Supabase (only the services this app uses)          |
| `npm run db:stop`          | Stop local Supabase                                             |
| `npm run db:reset`         | Recreate the local database from `supabase/migrations`          |
| `npm run db:test`          | pgTAP database tests (`supabase/tests`)                         |
| `npm run db:lint`          | Lint SQL functions (`plpgsql_check`)                            |
| `npm run db:types`         | Regenerate `src/shared/lib/database.types.ts` from the local DB |
| `npm run scan:secrets`     | Secret scan of the repository and the built `dist/`             |
| `npm run audit:deps`       | `npm audit` (high and critical)                                 |

## Environment variables

| Variable                        | Required        | Description                                                   |
| ------------------------------- | --------------- | ------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | for multiplayer | Project URL (`https://<ref>.supabase.co`)                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | for multiplayer | Publishable key (`sb_publishable_…`) or legacy anon key       |
| `VITE_CAPTCHA_PROVIDER`         | production      | `turnstile` or `hcaptcha` (bot protection for new identities) |
| `VITE_CAPTCHA_SITE_KEY`         | with provider   | The CAPTCHA widget's **public** site key                      |

Every `VITE_*` value ships to the browser. `src/shared/lib/env.ts` validates both values,
and it **refuses secret/service-role keys**. Without them, the landing page still renders
and room actions explain that the server isn't configured.

## Architecture

```
src/
  app/              Composition root: providers, router, layout, global styles, route pages
  domain/           Pure game rules — no React, no Supabase, fully unit-tested
  features/
    auth/           Anonymous Supabase identity (AuthProvider, useAuthSession)
    landing/        Landing page
    rooms/          Room server state: RPC/API layer, error mapping, query hooks, forms
    lobby/          /room/:code — access resolution, lobby UI, host controls, leave
    presence/       Realtime channel, presence, heartbeat, connection state
    game/           Round screens, server clock, game read model, answer autosave
  shared/
    hooks/          Generic hooks (clipboard)
    lib/            Env validation, Supabase client, generated DB types, query client, storage
    ui/             Design-system primitives: Button, Dialog, TextField, Notice, icons
  test/             Test setup, render helpers, integration tests
supabase/
  migrations/       SQL schema + RPCs (source of truth for persistence and authority)
  tests/database/   pgTAP tests
```

**Why this shape**

- **`domain/` is the heart.** Categories, the alphabet, normalization, scoring, the phase
  state machine, host election, display-name and room-code rules are pure functions.
  Where the server enforces the same rule (host election, name keys, timing constants),
  the SQL mirrors the domain function and both are tested.
- **Server state lives in TanStack Query.** Room and member data are fetched through
  `features/rooms/api` and kept fresh by realtime events written into the query cache.
  React context holds only the anonymous identity. There's no Redux and no duplicated
  server state.
- **Realtime is isolated.** All subscriptions live in `features/presence`
  (`useRoomConnection`) and are mounted once per room, above the phase switch, so they
  survive every game phase. Presentation components never subscribe themselves.
- **Features own their UI and orchestration.** `shared/` contains no game rules.

## Multiplayer architecture

### Identity

On first load, `AuthProvider` calls `ensureAnonymousSession`. It reuses the session that
supabase-js persisted in localStorage, or creates one with `signInAnonymously()`.
Concurrent callers share one in-flight promise, so StrictMode never creates two users.
`auth.uid()` is the player id everywhere. The client never sends player or host ids.

**Server unreachable ≠ signed out.** If restoring the stored session fails with a network
error (server down, offline), the client keeps the stored session and does **not** create
a new anonymous user — that would silently change the player's identity and cost them their
seat. Instead it shows "Свързване...", after 6 s "Сървърът не отговаря. Опитваме отново...",
and retries automatically every 5 s (plus a manual retry button). Only a definitive auth
rejection leads to a fresh anonymous session.

### Server-authoritative RPCs

| RPC                                                                           | Purpose                                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `create_room(display_name, capacity)`                                         | Server-generated unique code (CSPRNG, collision retry); creator joins as host                   |
| `join_room(code, display_name)`                                               | Join, or **rejoin** if already a member or a game participant. Returns the canonical code.      |
| `leave_room(room_id)`                                                         | Intentional leave; host re-elected in the same transaction; a running sheet is locked as `left` |
| `heartbeat(room_id)`                                                          | Liveness + lazy maintenance: lobby seat expiry, host migration, game advancement                |
| `start_game(room_id)`                                                         | Host only, LOBBY only, ≥ 2 players: creates round 1 + participant snapshot                      |
| `start_next_round(room_id)`                                                   | Host only, RESULTS only, letters left, ≥ 2 eligible players: round N+1 + new snapshot           |
| `finish_game(room_id)`                                                        | Host only, RESULTS of the last round with all 28 letters used → FINISHED (idempotent)           |
| `set_round_ready(room_id)`                                                    | Pre-round ready for the caller; the last one triggers the letter draw                           |
| `save_answers(room_id, round_id, answers)`                                    | Upserts the caller's answers while the round is open (server time)                              |
| `lock_answers(room_id, round_id)`                                             | STOP: atomically closes answering for all participants                                          |
| `set_results_ready(room_id)`                                                  | Independent READY; all required confirmations start geographic validation                       |
| `get_game_state(room_id)`                                                     | Read model: phase, round timing, letter (once revealed), statuses, server time                  |
| `get_round_results(room_id, round_id?)`                                       | Server-scored results of a revealed round + standings as of that round                          |
| `get_game_summary(room_id)`                                                   | Final standings (points, rounds played), room code, rounds completed                            |
| `report_visibility(room_id, round_id, visible, unloading?)`                   | The caller's game page became hidden / visible again (server time; "away" only while PLAYING)   |
| `get_round_activity(room_id, round_id)`                                       | A round's away intervals, clamped to each player's answering window                             |
| `set_answer_invalidated(room_id, round_id, player_id, category, invalidated)` | Current host only: invalidate / restore an answer                                               |

Expected failures return a stable code (`room_full`, `display_name_taken`, …) marked with
`HINT = 'app_error'`. The client maps only whitelisted codes to Bulgarian copy
(`features/rooms/api/roomErrors.ts`). Anything else becomes a generic message, and the
details are logged in development only.

Each RPC locks the room row (`SELECT … FOR UPDATE`) before doing anything else. All writes
for one room are therefore serialized, which makes capacity, name uniqueness and host
election atomic. A partial unique index enforces unique active names at the database
level as well.

### Membership vs presence

- **Membership:** "belongs to the room". A `room_players` row whose `left_at` is null.
  The primary key `(room_id, player_id)` means one row per player per room, ever.
  Refreshes and rejoins reuse that row.
- **Presence:** "connected right now". Realtime Presence on the private channel
  `room:<id>`, keyed by player id. It's fast but best-effort, and it's what drives the
  green/amber/gray dots.
- **Heartbeat:** `last_seen_at`, updated every 15 s. It's the server's authority for slow
  decisions.

| Situation                          | What happens                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Brief network drop / app switch    | Presence drops → others see "Свързва се отново". Membership and host role are untouched.        |
| Refresh                            | Same anonymous session → same membership row → lobby restored                                   |
| No heartbeat for **45 s**          | Counts as disconnected. If this is the host, the role moves to the earliest _connected_ member. |
| No heartbeat for **2 min** (LOBBY) | Seat released (`left_reason = 'expired'`), so ghosts don't block the room                       |
| "НАПУСНИ СТАЯТА"                   | `leave_room`: `left_reason = 'left'`, host handed over atomically, channel cleaned up           |

`beforeunload` is never relied on. Maintenance runs inside every RPC, and each connected
client sends a heartbeat every 15 s, so stale players and hosts are handled whenever
anyone is in the room. No scheduler is required.

### Host migration

The rule is `elect_room_host` in SQL, mirrored by `selectNextHost` in the domain layer.
Among members who haven't left, it picks connected members first, then the earliest
`joined_at`, then the lowest `player_id`.

- **Host leaves:** a new host is elected immediately, in the same transaction.
- **Host stale (> 45 s):** the role moves on the next heartbeat from anyone else, and only
  to a _connected_ member.
- **Empty room:** the next person to join becomes host.

There's one `host_player_id` column, so the room can never have two hosts.

### Rejoin rules

- **Active member** (refresh, second tab, reconnect): always succeeds and changes nothing.
  The original display name is kept.
- **Member who left or expired, room in `LOBBY`:** may rejoin if there's a free seat and
  the name is free. The same row is reused with a fresh `joined_at`, so they go to the
  back of the host-election order and don't reclaim host.
- **Game participant who left, game running:** may come back to the same game as
  themselves, with the same row, original name and join order. A sheet locked by leaving
  stays locked for that round. If they return **after** the current round's snapshot was
  taken, they watch that round ("Рунд N вече тече") and are included from the next one.
- **New players** can join only in `LOBBY`.

### Reconnect UX

The connection pill shows "Свързване..." / "Свързан" / "Свързваме отново..." /
"Връзката е прекъсната", with a soft banner while degraded. A transient failure never
navigates the player away. supabase-js rejoins the channel automatically. Every
successful (re)subscribe refetches room data to fill any gap, and Realtime is configured
to report `SUBSCRIBED` only once the change stream is live.

## Gameplay

### Flow

```
LOBBY ──start_game (host)──▶ ROUND_WAITING ──all ready──▶ COUNTDOWN (3 s) ──started_at──▶ PLAYING (60 s)
PLAYING ──STOP | ends_at──▶ (ROUND_LOCKED) ▶ RESULTS_READY ──all ready──▶ MAP_VALIDATING ──▶ REVEAL ──11 s──▶ RESULTS
```

`ROUND_LOCKED` is passed through inside the locking transaction. The persisted phase after a
round ends is `RESULTS_READY`, and the client treats both the same.

### Starting the game

Only the current host can start, only in `LOBBY`, and only with ≥ 2 active players.
`start_game` runs under the room lock and does three things:

1. creates round 1, with no letter and no timer yet;
2. snapshots every active member as a **round participant** (an `answer_sheets` row);
3. moves the room to `ROUND_WAITING`.

A second call fails with `game_already_started`, so double clicks never create two games.
From then on, new players get `game_in_progress`.

### Participants and who must be ready

The participant set of a round is fixed when the round is created.

| Check                          | Required participants                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Pre-round ready, results-ready | Not left **and** heartbeat within 45 s (the same staleness rule as host migration) |
| Early round finish             | First accepted STOP from an active participant                                     |

So a 1-second Wi-Fi drop never starts a round without someone, and a player who has gone
for good never blocks a ready check forever. Lobby seat expiry (2 min) applies to `LOBBY`
only. Participants of a running game are never removed for being silent.

### Ready stages

There are two independent ready checks and an answering phase:

- `ready_checks` with `stage = 'pre_round'`;
- STOP ends answering for everyone; tab exit locks the individual sheet;
- `ready_checks` with `stage = 'pre_results'`.

Rows are keyed by round, so nothing leaks between stages or rounds. Every ready RPC is
idempotent, and a retry that arrives after the stage completed succeeds silently.

### Letter selection

When the last required player is ready, `advance_game` draws a random letter, ordering by
`gen_random_uuid()`. It picks from the 28 eligible letters **minus every letter already
drawn in this room** (`rounds.letter`). Two constraints make a repeat impossible even if
there's a bug:

- `UNIQUE (room_id, letter)` on `rounds`;
- a check on `rooms.used_letters` (eligible letters only, no repeats).

Clients never send a letter. `start_next_round` refuses to create a round when no
letter is left (`no_letters_left`), so round 28 always draws the last remaining letter and
a 29th round cannot exist.

The letter stays secret until `started_at`:

- clients have no SELECT privilege on `rounds.letter`;
- `rooms.used_letters` is only extended at the reveal;
- `get_game_state` returns the letter only once server time passes `started_at`.

### Authoritative timing

The server writes all three timestamps in the same transaction as the draw:
`countdown_at = now()`, `started_at = countdown_at + 3 s`, `ends_at = started_at + 60 s`.

- **Answer writes** are checked against those timestamps directly
  (`started_at ≤ now() < ends_at`). Correctness never depends on the persisted phase.
- **Persisted phase changes** happen lazily in `advance_game`: `COUNTDOWN → PLAYING`, and
  `PLAYING → RESULTS_READY` on timeout. It runs inside every room RPC, including every
  client's 15 s heartbeat. PostgreSQL never has to act on its own, and no single browser
  (host or otherwise) is required.
- **Clients** decide what to show from the timestamps and an **estimated server clock**.
  Every `get_game_state` returns `clock_timestamp()`. The offset is
  `server − request midpoint`, and the sample with the smallest round trip is kept
  (`features/game/clock/serverClock.ts`).
- **Catching up:** screens switch exactly at `started_at` / `ends_at` even if the database
  lags. The client then **nudges** the server with heartbeats until it catches up
  (`useDeadlineNudge`).
- **Timers** re-render once per second, aligned to `ends_at`, so every client flips the
  displayed second at the same moment. A refresh restores the exact remaining time.

### Countdown

"3 · 2 · 1" is `ceil((started_at − serverNow) / 1000)`, recomputed on each aligned tick.
There's no `setInterval` counter. A refresh mid-countdown shows the right number, and a slow
device can only render late, never delay anyone. At `started_at` the client fetches the
letter and reveals it with a short animation. It then stays in the sticky header next to
the timer.

### Answers: autosave, privacy, locking

- **Autosave:**
  - Inputs update locally at once.
  - Changed categories are sent in one `save_answers` call after 500 ms of quiet.
  - Writes are chained, so they arrive in order. Failures are re-queued and retried every 2 s.
  - Pending edits are flushed before STOP, 1.5 s before the deadline, and on unmount.
  - `beforeunload` isn't relied on. A refresh restores the latest persisted answers.
- **Stored form:** NFC, surrounding whitespace trimmed, casing kept, max 100 characters. The
  server also stores the duplicate key (`normalize_answer`, which mirrors `normalizeAnswer`).
- **Privacy:**
  - RLS lets a player read only their **own** answers until the round's reveal. That means
    `REVEAL`, `RESULTS`, `FINISHED`, or a later round. This includes the host.
  - The `answers` table isn't in the Realtime publication. Only status rows
    (`answer_sheets`, `ready_checks`) are broadcast.
- **STOP:** flush, then `lock_answers`. The first accepted request sets the round lock
  (`lock_reason = 'stop'`) and enters `RESULTS_READY`; later STOP calls do nothing.
  All saves take the same room row lock, so a write cannot slip through after STOP.
- **Tab exit:** the browser closes its draft immediately; `report_visibility` atomically
  persists its last snapshot and locks the sheet as `tab_exit`. Returning never unlocks it.
- **Timeout:**
  - At `ends_at` the client locks the inputs immediately.
  - The server rejects any later write (`round_over`).
  - The next request from any player locks the round (`lock_reason = 'timeout'`,
    `locked_at = ends_at`).
  - Unfinished players keep whatever was last persisted.

### Disconnects, leaving and host changes during a game

- **Disconnect:** nothing is removed, answers persist, and the timer runs on. Reconnecting
  restores the form. If the round ends meanwhile, the persisted answers are what count.
- **Leaving (НАПУСНИ СТАЯТА):**
  - Membership gets `left_at`, but the participant row and every answer stay.
  - If the round is running, the sheet is locked as `left`, so the player never blocks it.
  - They may rejoin the same game as themselves. Brand-new users may not.
- **Host migration** only changes `rooms.host_player_id`. Rounds, letters, ready states and
  timers are untouched, and core gameplay never depends on the host being present.

## Results

### Flow

```
RESULTS_READY ──all ready──▶ MAP_VALIDATING ──geographic checks──▶ REVEAL [reveal_at fixed by the server] ──reveal_at + 11 s──▶ RESULTS
```

The final "ГОТОВ ЗА РЕЗУЛТАТИТЕ" request sets `rounds.reveal_at = now()` under the room lock.
`advance_game` both establishes the reveal and later moves `REVEAL → RESULTS`, so concurrent final
requests produce exactly one timeline. `RESULTS` is effective on every screen as soon as
server time passes `reveal_at + 11 s`; the persisted phase follows on the next request of any
player (heartbeats included) — no particular browser is needed.

### Scoring (authoritative, server-side)

Scores are **derived**, never stored: `round_cells(round)` computes every cell from the answers and
their invalidation state each time results are read. Per category:

1. take the submitted answer (no answer = empty)
2. empty after normalization → **empty**, 0
3. invalidated by the host → **invalid**, 0, and removed from duplicate grouping
4. normalize the remaining valid answers (`normalize_answer`: NFC, trimmed, whitespace runs
   collapsed, ICU lowercase — same as `normalizeAnswer`)
5. group equal normalized values per category
6. group size > 1 → **duplicate**, 0 for every member
7. group size = 1 → **unique**, 1

So `Монтана`, `монтана` and `МОНТАНА` are one answer; `Стара Загора` and `Стара-Загора` are
not (no fuzzy or semantic matching). Maximum per round: 7. Cumulative totals sum the cells of
every revealed round of the room, so historical rounds stay queryable and unchanged, and the model
extends to all 28 rounds without changes. The integration suite cross-checks the server results
against the pure domain implementation (`scoreRound`).

### Result API

`get_round_results(room_id, round_id?)` — active members only, only once the round is revealed —
returns the round (number, letter, `reveal_at`) and, per participant in **stable join order**:
`display_name`, `left`, `round_points`, `total_points` and seven cells
`{ category, answer (original text), state, points, duplicate_count }`. No internal ids beyond the
player ids the client already knows, and nothing about who invalidated what. It also returns
`round.is_current` and `standings` — every game participant's `total_points` and `rounds_played`
**as of that round** (rounds after it are ignored), so a historical round shows the leaderboard
exactly as it was. Players absent from a round have no row in it.

### Synchronized reveal

The reveal is a fixed timeline relative to `reveal_at` (`src/domain/reveal.ts`), mapped onto the
estimated server clock by every client:

| Time (s)   | What appears                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------ |
| 0 – 2      | Darkened screen: "ПРОВЕРЯВАМЕ ОТГОВОРИТЕ" with animated dots                                     |
| 2 – 2.6    | Results table, all cells concealed                                                               |
| 2.6 – 9.6  | One category per second, in official order: the whole column reveals together (tiny row stagger) |
| 9.6 – 10.6 | Round totals (count-up from 0 to the authoritative value)                                        |
| 10.6 – 11  | Overall leaderboard                                                                              |
| 11         | Complete → RESULTS                                                                               |

Clients re-render only at these boundaries (≈ 12 times), never per frame. A refresh or reconnect
resumes at the current position; after the reveal it shows the final results immediately.

### Results table & cell states

Columns: Играч · Държава · Град · Село · Животно · Растение · Предмет · Име · Точки. Rows keep the
round-participant order for the whole screen (only the leaderboard reorders). Players who left
stay in the table with "напуснал".

| State     | Look                          | Meaning conveyed without colour                                                   |
| --------- | ----------------------------- | --------------------------------------------------------------------------------- |
| unique    | green                         | ✓ icon, "+1", "уникален" for screen readers                                       |
| duplicate | red                           | overlapping-squares icon, "×N" group size, tooltip "Същият отговор имат N играчи" |
| empty     | dim                           | "—", "празен"                                                                     |
| invalid   | dashed violet, struck-through | ⊘ icon, "невалиден"                                                               |

A legend under the table explains the four states in words.

### Leaderboard

"ОБЩО КЛАСИРАНЕ" orders by cumulative points with **competition ranking** (1, 2, 2, 4): equal
totals share a rank and no winner is invented; tied rows keep the stable participant order. Each
row also shows the round's "+N". When totals change, rows glide to their new positions (FLIP).

### Host invalidation

Only the **current** host — checked on the server after any due host migration — can call
`set_answer_invalidated(room, round, player, category, invalidated)`, only for the current round,
only in `REVEAL`/`RESULTS`, and only for a non-empty answer. The host taps/clicks a revealed cell,
which opens a small action dialog ("ОТБЕЛЕЖИ КАТО НЕВАЛИДЕН" / "ВЪЗСТАНОВИ ОТГОВОРА") — two
deliberate steps, so a stray click never changes a score. Requests are idempotent and serialized
by the room lock. State lives on `answers.invalidated_at/by`; every real change appends an audit
row (`answer_invalidation_events`: who, what, when, invalidate/restore) that clients cannot read
or write. A host change moves the authority immediately and changes nothing else.

### Realtime score updates

Each real invalidation/restore bumps `rooms.results_revision`. `rooms` is already published, so
every client receives the update and refetches `get_round_results` — the answers table is never
broadcast. Cells, totals and the leaderboard update on all screens without a refresh.

### Mobile and reduced motion

- Phones: the table scrolls horizontally inside its panel (never the page) with a sticky player
  column and a sticky points column. During the live reveal the newly revealed column is scrolled
  into view — until the player touches/scrolls the table themselves; never after the reveal.
- Desktop: the full table fits; the leaderboard sits below it, or beside it on very wide screens.
- `prefers-reduced-motion`: cell and overlay animations are effectively disabled (global CSS),
  totals appear without counting, leaderboard rows don't glide, auto-scroll jumps instead of
  scrolling. The paced reveal timeline itself stays the same for everyone.
- Screen readers hear "Проверяваме отговорите..." once and, at the end, "Резултатите са готови"
  with their own round and total score — not every animation step.

## The 28-round game

### Lifecycle

```
RESULTS (round N < 28) ──host: НОВ РУНД──▶ ROUND_WAITING (round N+1) ──▶ … ──▶ RESULTS (round N+1)
RESULTS (round 28)     ──host: ВИЖ КРАЙНОТО КЛАСИРАНЕ──▶ FINISHED
```

A game is exactly as long as the letter set: one round per eligible letter, 28 rounds.
"Изиграни букви: N / 28" is shown under the results. There is no early end and no rematch yet.

### Starting the next round

`start_next_round` runs under the room lock and is accepted only from the **current** host
(after any due host migration), only in `RESULTS`, only while letters remain and only with
at least **2 eligible players**. In one transaction it:

1. inserts round N+1 (`round_number` must be exactly max + 1 — enforced by a trigger);
2. snapshots the eligible players as the round's participants (`answer_sheets`);
3. moves the room to `ROUND_WAITING`.

It does **not** draw a letter or start a timer: that still happens only when every required
participant pressed "ГОТОВ". Ready rows and answers are keyed by round, so the new round starts
with nobody ready and an empty form. A double click or ten simultaneous requests create exactly
one round; the others get `round_already_started`, which the UI ignores.

**Eligible = not left and heartbeat within 45 s** — the same rule as the ready checks. A player
who is merely reconnecting for a second is included; someone gone for good is not. With fewer
than 2 eligible players the request fails with `not_enough_players` and the room stays in
`RESULTS` (it never finishes on its own); the host sees "Нужни са поне 2 свързани играчи…".

The snapshot is immutable: a trigger rejects any `answer_sheets` insert outside the
transaction that created the round, even with privileged access. A player who rejoins after the
snapshot sits that round out — and gets **no** fabricated 0-point row for it.

### History

Every revealed round stays readable. On the results screen the round navigator
("Предишен рунд" / "Следващ рунд", plus a picker "Рунд N / 28 · Буква") lets each player browse
earlier rounds locally — it never changes what others see. A historical round is clearly
marked "ПРЕДИШЕН РУНД … само за преглед", shows the standings **as of that round**
("КЛАСИРАНЕ СЛЕД РУНД N"), skips the reveal animation and offers no invalidation. The server
enforces the same: invalidation is accepted only for the current round in `REVEAL`/`RESULTS`,
so a round is frozen the moment the next one is created. Results of past rounds are cached
forever on the client (they cannot change).

### Finishing

After round 28's results the host sees "ВИЖ КРАЙНОТО КЛАСИРАНЕ" instead of "НОВ РУНД"; other
players see "Изчакваме хоста да завърши играта...". `finish_game` requires the current host,
`RESULTS` and all 28 letters used (`letters_remaining` otherwise); a repeated call after the
game finished is a harmless no-op. The room then becomes `FINISHED` (with `finished_at`), which
is terminal: no ready actions, answer edits, invalidations or new rounds (`game_finished`).
Results and history stay readable.

### Final screen

"КРАЙ НА ИГРАТА" with the room code, "28 / 28 букви", the winner line and "КРАЙНО КЛАСИРАНЕ"
(points and rounds played per player; players who left are marked). Ranking is competition
ranking (1, 1, 3); **ties are never broken artificially**: "Победител: Стоян",
"Победители: Стоян и Деси", "Победители: Стоян, Деси и Калоян". A light CSS-only confetti
plays once (none with reduced motion). "Резултати по рундове" expands the full round history.

### Host changes between rounds

The next-round and finish controls belong to whoever is host right now. If the host disappears
in `RESULTS`, the role moves after 45 s (as everywhere) and the new host gets the buttons; the old
host's requests are rejected with `not_host`.

## Fair-play round controls

STOP, READY, clipboard restrictions, tab locks, retries and deployment notes are documented
in [Round controls](docs/round-controls.md). Tab/window exit permanently locks answers for
the current round; stored answers still participate in normal scoring.

## Game feel: sound, motion and UX

### Sound controls

- A speaker button in the top bar: **"Звук: включен" / "Звук: изключен"** (accessible name and
  `aria-pressed`; icon and label change too). Keyboard accessible like any button.
- **Default: on.** The choice is stored **locally** (`localStorage`, key
  `darzhavi-i-gradove.sound`) — never on the server; each player controls their own speaker.
  Other open tabs follow the change. Muting also silences a sound that is already ringing.
- Sound is never the only feedback: every event it marks is also visible as text/state, and
  screen readers are not told about sounds (the existing live regions already describe the
  state changes).

### Autoplay and failure behaviour

Browsers only allow audio after a user gesture. The single `AudioContext` is created on the
first `pointerdown` / `keydown` / `touchend` anywhere in the app (joining, typing a name and
pressing a button all count). Until then, and whenever audio is unsupported, suspended or
throws, events are silently skipped — joining, READY, the countdown, gameplay and results
never wait for or depend on audio. Skipped sounds are **not queued**.

### Sound palette and events

All sounds are **synthesized at runtime with the Web Audio API** (`src/features/audio/synth.ts`):
short oscillator tones with envelopes and a little filtered noise. There are **no audio files**
(0 bytes of assets, nothing downloaded, no licensing questions) and **no background music**.
Levels are deliberately low (master gain 0.45 on top of quiet voices).

| Event (authoritative boundary)           | Sound                                       |
| ---------------------------------------- | ------------------------------------------- |
| Countdown 3 · 2 (`started_at − n s`)     | short tick                                  |
| Countdown 1                              | the same tick a step higher                 |
| `started_at` — the letter appears        | short bright "go" chord                     |
| Final 10 s, once per second              | very short quiet tick — **not** after ГОТОВ |
| `ends_at`                                | two-note "time's up"                        |
| Own ГОТОВ (answer lock) succeeded        | soft two-note confirm                       |
| Round ended early (everyone locked)      | short three-note cue                        |
| Reveal starts ("ПРОВЕРЯВАМЕ ОТГОВОРИТЕ") | one low swell (no loop)                     |
| Each category column (×7)                | **one** sound per column, by your own cell  |
| Round totals                             | short rising figure                         |
| Leaderboard                              | soft whoosh + note                          |
| FINISHED (first arrival only)            | short fanfare                               |

Category columns make one sound, never one per cell: the tone follows **the current player's
own answer** in that column — crisp for unique, flat for a duplicate, muted for invalid, a
neutral tick for empty (or for a spectator). Host invalidations after the reveal are silent
(the changed cells get a one-second highlight instead). History, fair-play events and the
lobby make no sound.

### No duplicates, no drift, no backlog

- Every sound is a **cue for a game event** with an identity key — room/round + event type +
  boundary, e.g. `round:<id>:countdown:3`, `round:<id>:tick:7`, `round:<id>:category:city`,
  `room:<id>:finished`. The engine's gate gives each key exactly one decision (play, or skip
  for a reason) and remembers it, so re-renders, React StrictMode, query refetches, realtime
  echoes and refreshes never repeat a sound.
- Cues carry the **server time** of their boundary and are dropped when they arrive too late
  (default 0.9 s; the suspense 1.8 s; the winner 8 s). A refresh at 7 s continues with the
  tick for 7 — it never plays 10 · 9 · 8; a refresh on FINISHED does not replay the fanfare.
- Sounds hang off the existing authoritative boundaries (the same `useServerSecondTick` /
  reveal timeline the UI uses) — there is no second countdown that could drift.
- **Background tabs:** a hidden page makes no sound, the `AudioContext` is suspended while
  hidden, and nothing missed is replayed on return — it simply continues from the current
  state.
- After the player's own ГОТОВ the final-seconds ticking stops for them (they are waiting, not
  racing); the "everyone is ready" cue and the reveal still sound.
- For diagnostics the engine dispatches a `gameaudio:cue` DOM event for every decision (key,
  sound id, and `play` or why it was skipped: duplicate / stale / hidden / muted / unavailable);
  the browser tests use it.

### Motion system

Four durations and three easing curves, defined once as CSS custom properties / theme tokens
(`src/app/styles/index.css`) and mirrored in `src/shared/motion/motion.ts` for JavaScript:

| Token      | Duration | Used for                                               |
| ---------- | -------- | ------------------------------------------------------ |
| `instant`  | 120 ms   | hover / press feedback, status swaps                   |
| `fast`     | 200 ms   | small state changes, toasts, badges, focus halo        |
| `normal`   | 360 ms   | screen and panel entrances, leaderboard reorder        |
| `dramatic` | 720 ms   | game events: countdown numbers, the letter, the winner |

Curves: `standard` (most things), `emphasized` (game events), `exit`. Effects are reserved
for game events; ordinary UI only gets subtle hover/press/focus feedback.

- **Screens:** each major game screen (waiting, countdown, playing, results-ready, results,
  finished) enters with a ~360 ms fade + 8 px rise, keyed by screen + round so it plays once
  per screen change. There is no exit animation — server state is shown the moment it
  arrives, nobody waits for anyone's animation.
- **Countdown:** each number enters (scale + de-blur), holds, and exits; a ring pulses with it.
- **Letter:** a ~1.1 s spotlight overlay that never takes pointer events (typing works from
  `started_at`), then the header tile "lands" with a short glow.
- **Playing:** fields show a focus halo and a filled marker; the save line is one quiet,
  fixed-height status ("Запазваме..." / "Запазено" / "Няма връзка — пазим отговорите…").
  Player statuses swap in place ("Пише..." → ✓ "Готов"); the row and name never move.
- **ГОТОВ:** the button is replaced, in place and at the same height, by "✓ ГОТОВ СИ —
  Изчакваме останалите..." (same for both ready checks and the answer lock).
- **Timer:** calm > 30 s, warning colour ≤ 30 s, red with a one-shot beat per second ≤ 10 s.
- **Reveal:** the revealed column header flashes once, cells flip in (tiny row stagger),
  totals count up, leaderboard rows rise in and totals count from the previous total. On
  phones the table follows the reveal and returns to the first column afterwards.
- **History is quiet:** no reveal, no count-up, no sounds — values appear immediately.
- **FINISHED:** one ~3 s CSS confetti burst (28 pieces, removed afterwards, once per game per
  browser session), a crowned winner line with points; tied winners share exactly the same
  emphasis ("Победители: Стоян и Деси", "142 точки всеки").

### Reduced motion

With `prefers-reduced-motion: reduce` all durations collapse to ~1 ms (state changes still
happen instantly), decorative motion is removed (confetti, drifting letters), the countdown
numbers, letter, timer colours, reveal steps and leaderboard remain fully readable, and
nothing ever waits for an animation event. Reduced motion does **not** change the sound
preference — those are separate choices.

### Terminology (UI)

рунд · готов / не е готов / ГОТОВ СИ · резултати · класиране (ОБЩО / КРАЙНО) · хост · играч ·
активност · "напусна играта" / "се върна" (fair play) · "напусна" (left the room — gender-
neutral, names do not tell us anyone's gender).

### Tested viewports

Phones 320×568, 360×800, 390×844, 430×932; tablet 768×1024 (portrait) and 1024×768
(landscape); laptop 1366×768, 1440×900; desktop 1920×1080 — lobby, ready check, playing,
results-ready, results, finished, with 15 players. No horizontal page overflow (the results
table scrolls inside its own container on narrow screens); content is capped at readable
widths (`max-w-3xl` for play, `max-w-7xl` for results) on large displays.

## Game state machine

```
LOBBY → ROUND_WAITING → COUNTDOWN → PLAYING → ROUND_LOCKED → RESULTS_READY → MAP_VALIDATING → REVEAL → RESULTS
             ↑                                                                          │
             └──────────────────────── host: "НОВ РУНД" ────────────────────────────────┤
                                                                                        ↓
                                         FINISHED (host, after round 28 — all letters used)
```

| Phase            | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `LOBBY`          | Players join; host waits                                              |
| `ROUND_WAITING`  | Pre-round ready check ("ГОТОВ")                                       |
| `COUNTDOWN`      | Short countdown, then the letter is revealed                          |
| `PLAYING`        | 2-minute answering window; "ГОТОВ" submits and locks your answers     |
| `ROUND_LOCKED`   | All answers locked (everyone submitted, or time ran out)              |
| `RESULTS_READY`  | Pre-results ready check                                               |
| `MAP_VALIDATING` | Country, city and village answers are checked against geographic data |
| `REVEAL`         | Suspense + animated reveal                                            |
| `RESULTS`        | Results table, host invalidation, leaderboard; host starts next round |
| `FINISHED`       | All 28 letters played and the host opened the final standings         |

The legal transitions are in `src/domain/phases.ts` (`PHASE_TRANSITIONS`).

## Game rules

- Categories: Държава, Град, Село, Животно, Растение, Предмет, Име. **Точки** is computed.
- Letters: the Bulgarian alphabet without **Ъ** and **Ь** (28 letters). Each letter is
  used at most once per game and drawn randomly server-side.
- Scoring pipeline, per category per round (`src/domain/scoring.ts`):
  1. normalize answers
  2. remove empty answers (0 points)
  3. remove answers the host invalidated (0 points)
  4. build duplicate groups among the **remaining** valid answers
  5. unique answers get **1** point
  6. duplicates get **0** for every holder

  For example, A and B both write "Монтана", so both score 0. If the host invalidates A's
  answer, A is invalid (0) and B becomes unique (1).

- Duplicate comparison uses `normalizeAnswer`: NFC Unicode normalization, collapsed
  whitespace, trimmed, and Bulgarian-locale lowercase. Nothing else is folded.
- Countries are checked against a local list, and cities and villages against
  Geoapify/OpenStreetMap data. The host judges answers in the other categories.
- Display names are trimmed, 1–20 characters, and unique among a room's active players
  (case-insensitive). They're never auto-renamed.

## Security considerations

- Only the publishable key is in the frontend. `env.ts` rejects secret keys.
- RLS is enabled on every table. Only members who haven't left can read their room. A
  non-member and a non-existent room look identical through table reads, so codes can't
  be enumerated that way.
- Clients have **no** INSERT/UPDATE/DELETE privileges on any table. All functions are
  private by default; only the seventeen client RPCs and the RLS helpers are granted to
  `authenticated`. Clients cannot read `rounds.letter` at all (column privilege). The `anon` role (not signed in) can't read anything.
- Realtime uses **private channels**, authorized by RLS policies on `realtime.messages`,
  so only active members can join `room:<id>`.
- Display names are rendered as text by React and constrained in the database.
- **Rate limiting** (server-side, per anonymous identity and operation) via a PostgREST
  pre-request hook, plus a 16 KB request-size limit; room-code guessing is limited
  (`join_room` returns `NULL` for an unknown code so that misses are counted). Calm UI
  copy: "Твърде много заявки. Опитай отново след малко."
- **CAPTCHA** (Turnstile/hCaptcha) for creating a new anonymous identity, enforced by
  Supabase Auth; shown once per device, never for game actions.
- **Retention:** abandoned rooms and finished games are deleted automatically (hourly
  `pg_cron` job).
- Strict **Content-Security-Policy** and security headers generated by the build; fonts
  are self-hosted (no third-party requests).

Full details: [`docs/security.md`](docs/security.md) (threat model, RPC matrix, RLS,
Realtime, rate limits, input limits) and [`supabase/README.md`](supabase/README.md).

## Production, deployment and operations

| Document                                                 | Contents                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`docs/production.md`](docs/production.md)               | Hosted Supabase setup: migrations, extensions, Auth, CAPTCHA, Realtime, environment     |
| [`docs/deployment.md`](docs/deployment.md)               | Static hosting, SPA fallback, security headers, HTTPS, rollback                         |
| [`docs/operations.md`](docs/operations.md)               | Observability, retention/cleanup, request volume, database growth, performance baseline |
| [`docs/security.md`](docs/security.md)                   | Security model and abuse protection                                                     |
| [`docs/release-checklist.md`](docs/release-checklist.md) | Go-live checklist (infrastructure, functional, devices, privacy, operations)            |
| [`docs/device-test-plan.md`](docs/device-test-plan.md)   | Manual iPhone / Android / desktop checks                                                |

CI: `.github/workflows/ci.yml` — typecheck, lint, format, unit tests, build, secret scan,
dependency audit; and a Supabase job (migrations from scratch, schema lint, pgTAP,
integration tests). No secrets are required.

Players can read the privacy notice at `/privacy` and the game/fair-play notice at
`/about` (linked in the footer).

## Open product questions

1. **Answer must start with the letter?** The spec has no such rule, so it isn't enforced.
2. **Ending early:** a game always lasts 28 rounds. Should the host be able to end it early,
   or start a rematch in the same room?
3. **Timing:** 45 s staleness, the 2 min lobby seat expiry, the 3 s countdown and the 500 ms
   autosave debounce are tunable defaults (`src/domain/config.ts` + SQL functions).
4. **Normalization edge cases:** should `ѝ` equal `и`? Should Latin look-alikes typed by
   mistake be folded into Cyrillic?
5. **Retention:** 24 h for abandoned rooms/games and 7 days for finished games are chosen
   defaults (see `docs/operations.md`).

## Known limitations

- A keystroke typed less than about 0.5 s before the deadline may not be persisted
  (debounce plus network time). The client flushes 1.5 s before `ends_at` to keep this
  window small. Server time is final.
- Clock offset is estimated from request round trips. Clients agree within tens of
  milliseconds on a normal connection, which is plenty for a party game.
- Right after `supabase db reset` the local Realtime pipeline needs about 10–20 s before
  private channels accept joins again (the first joins fail with "transport failure").
  The integration suite waits for this explicitly (`src/test/integration/realtimeReady.ts`).
  In production, clients just show "Свързваме отново..." and reconnect.
- Docker Desktop's VM clock can step backwards by a second or more right after the
  containers restart, and on WSL2 it was also observed running ~7 % fast with periodic
  corrections of ~1.5 s (a sawtooth). Clients keep their best clock sample for up to 60 s,
  so on such a machine two screens can briefly disagree by 1–2 s; NTP-synced hosted servers
  do not show this. The accelerated integration tests therefore shift simulated time with
  a generous margin (30 s) and print server time in their diagnostics. The same steps
  shorten or lengthen locally measured away intervals (they use the server's `now()`), so the
  browser scenarios use absences long enough to stay above the 2 s threshold.
- Sound output itself (how it actually sounds on a given speaker) cannot be verified
  automatically; the tests verify which sounds the engine decides to play, once, at the right
  boundaries. Some mobile browsers keep audio suspended until a tap inside the page even after
  earlier gestures; the game is fully usable without sound.
- Browser automation cannot put a page into the real "hidden" state, so fair-play and
  background-audio checks simulate the Page Visibility signal; refresh and offline are real.
- Presence dots are cosmetic, since the presence payload is chosen by the client. All
  decisions use heartbeats.
- Realtime is best-effort: every heartbeat (15 s) also reconciles the room summary (phase,
  host), the roster and the game state with the server, so a lost event is repaired within
  one heartbeat, and a client whose Realtime connection is blocked still follows the game.
- A device clock far ahead of real time (for example +1 h) makes supabase-js treat every
  access token as expired and refresh it repeatedly (measured: ~20 `auth/token` requests per
  minute). The game itself is unaffected (it uses server time), but these refreshes count
  against the hosted Auth rate limits. Severity: medium, accepted for v1.0.
- Firefox and WebKit could not be run on the development machine (missing Windows media
  libraries); cross-browser coverage there relies on API feature checks and the manual
  device plan.

## Known future work

Out of scope for Web v1.0 (deliberately not built): early end of a game, rematch,
custom categories or timers, accounts, chat, spectators.
