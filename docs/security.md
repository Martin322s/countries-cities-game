# Security model — Web v1.0

Everything authoritative lives in PostgreSQL. The browser holds only the public
publishable key; identity is a Supabase **anonymous** user (`auth.uid()`); every write
goes through a `SECURITY DEFINER` RPC that derives the caller from `auth.uid()`, locks
the room row, and re-checks phase, membership, host role and time on the server.

## Threat model (summary)

| Attacker                       | Can                                                                               | Cannot                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous visitor (no session) | Load the static site                                                              | Read or call anything (`anon` has no table or function privileges)                                                                    |
| Signed-in stranger             | Create rooms, try codes                                                           | Read any room they are not an active member of; guess codes at scale (rate limited); join a running game                              |
| Room member                    | Play by the rules                                                                 | Read others' answers before the reveal, read the hidden letter, write any table directly, act for another player, act in another room |
| Malicious member with DevTools | Call any RPC with any arguments, in any order, edit local state, change the clock | Violate a rule — every RPC re-validates on the server; time comes from the server clock                                               |
| Former member (left)           | —                                                                                 | Read the room, subscribe to its channel, call its RPCs                                                                                |
| Script / bot                   | Send many requests                                                                | Exceed per-identity rate limits; create identities without passing CAPTCHA (when enabled)                                             |

Known, accepted limits: a modified client can stop reporting fair-play visibility
(it is informational, not anti-cheat); presence dots are client-asserted (cosmetic); a device clock far ahead of real time
makes supabase-js refresh its token about 20 times per minute (game timing is unaffected;
the refreshes are subject to the hosted Auth rate limits).

## RPC security matrix

All functions: `SECURITY DEFINER`, `search_path = ''`, schema-qualified objects, no
dynamic SQL, executable by `authenticated` only (verified by
`supabase/tests/database/security_catalog.test.sql`). Identity is always `auth.uid()`;
no RPC accepts a player id for the _caller_. Timestamps are always server `now()`.

| RPC                      | Who                    | Room/round checks                           | Phase / time                                          | Duplicates                                           | Locking               |
| ------------------------ | ---------------------- | ------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- | --------------------- |
| `create_room`            | any signed-in          | — (creates)                                 | —                                                     | rate limited (10 / 10 min)                           | unique code retry     |
| `join_room`              | any signed-in          | by code; rejoin only as the same identity   | LOBBY for newcomers; participants may return mid-game | idempotent for members; misses counted (20 / 10 min) | room row `FOR UPDATE` |
| `leave_room`             | active member          | own membership only                         | any                                                   | second call `not_member`                             | room row              |
| `heartbeat`              | active member          | own row                                     | any                                                   | idempotent                                           | room row              |
| `start_game`             | current host           | caller's room                               | LOBBY, ≥ 2 players                                    | `game_already_started`                               | room row              |
| `set_round_ready`        | round participant      | current round                               | ROUND_WAITING                                         | idempotent                                           | room row              |
| `save_answers`           | participant, own sheet | `round_id` must be the room's current round | `started_at ≤ now() < ends_at`, sheet unlocked        | upsert                                               | sheet row             |
| `lock_answers`           | participant            | current round                               | after `started_at`                                    | idempotent                                           | room + sheet          |
| `set_results_ready`      | participant            | current round                               | RESULTS_READY                                         | idempotent                                           | room row              |
| `get_game_state`         | active member          | caller's room                               | read                                                  | —                                                    | —                     |
| `get_round_results`      | active member          | round of that room                          | revealed only                                         | —                                                    | —                     |
| `set_answer_invalidated` | current host           | current round only                          | REVEAL / RESULTS                                      | idempotent; audited                                  | room row              |
| `start_next_round`       | current host           | caller's room                               | RESULTS, letters left, ≥ 2 eligible                   | `round_already_started`                              | room row              |
| `finish_game`            | current host           | caller's room                               | RESULTS of round 28                                   | idempotent                                           | room row              |
| `get_game_summary`       | active member          | caller's room                               | read                                                  | —                                                    | —                     |
| `report_visibility`      | participant            | `round_id` must be current for "away"       | effective PLAYING, sheet unlocked                     | one open interval (unique index)                     | room row              |
| `get_round_activity`     | active member          | round of that room                          | read                                                  | —                                                    | —                     |

Helper functions callable by clients (`is_room_member`, `is_round_member`,
`can_access_room_topic`, `round_answers_revealed`) only answer questions about the
caller or reveal non-sensitive booleans; they back RLS and Realtime policies.

## Row Level Security

- RLS is enabled on every table; there are **no** write policies and clients have **no**
  INSERT/UPDATE/DELETE/TRUNCATE privileges anywhere (tested).
- Read policies: a table row is visible only to active members of its room.
- `answers`: own answers always; others only once the round is revealed.
- `rounds.letter`: no column privilege — only `get_game_state` reveals it at `started_at`.
- `answer_invalidation_events`: no client access at all (audit trail).
- `private` schema (rate limits, cleanup): not exposed by the API; clients can run only the
  request hook.

## Realtime

- One private channel per room, `room:<id>`, authorized by RLS on `realtime.messages`
  (active members only). Outsiders, former members and forged topics are rejected
  (tested in `security.integration.test.ts`).
- Published tables carry status only: `rooms`, `room_players`, `answer_sheets`,
  `ready_checks`, `visibility_events`. Never `answers`, never `rounds`.
- Postgres Changes are delivered per subscriber after RLS.

## Rate limiting

Implemented in the database as a PostgREST **pre-request hook**
(`private.check_request`, migration `20261007000000`). It runs before every API request,
in the request's transaction:

- Rejects bodies larger than 16 KB (`payload_too_large`) — the largest legitimate request
  is ~1.5 KB.
- Counts each signed-in identity's requests per operation in fixed windows (an UNLOGGED
  counter table; stale windows are deleted hourly) and raises `rate_limited`.
- GET/HEAD (direct table reads) run in read-only transactions and are not counted; they
  are RLS-protected and cheap. Read floods are a platform/gateway concern.
- A failed request is rolled back with its counter — fine, it did no work. Room-code
  guessing is the exception: `join_room` returns `NULL` for an unknown code (instead of
  raising), so the miss counter commits.
- The service role is never limited.

| Operation                                                     | Limit       | Normal use (15-player game) |
| ------------------------------------------------------------- | ----------- | --------------------------- |
| `create_room`                                                 | 10 / 10 min | 1                           |
| `join_room`                                                   | 30 / min    | 1–2                         |
| join misses (unknown codes)                                   | 20 / 10 min | 0–2                         |
| `start_game`, `start_next_round`, `finish_game`, `leave_room` | 30 / min    | ≤ 1                         |
| `set_round_ready`, `set_results_ready`, `lock_answers`        | 60 / min    | 1–3                         |
| `set_answer_invalidated`                                      | 120 / min   | a few                       |
| `heartbeat`                                                   | 120 / min   | 4–8                         |
| `save_answers`                                                | 600 / min   | ≤ 120 (500 ms debounce)     |
| `report_visibility`                                           | 240 / min   | a few                       |
| `get_game_state`                                              | 1200 / min  | 4 + one per realtime event  |
| `get_round_results`                                           | 600 / min   | a few per round             |
| `get_round_activity`                                          | 900 / min   | one per fair-play event     |
| `get_game_summary`                                            | 300 / min   | 1                           |
| anything else                                                 | 600 / min   | —                           |

Limits are rows in `private.rate_limit_rules` and can be tuned without a deploy:

```sql
update private.rate_limit_rules set max_requests = 20 where op = 'create_room';
```

The UI maps `rate_limited` to "Твърде много заявки. Опитай отново след малко."

Platform-level limits that complement this (configure in the Supabase dashboard):
anonymous sign-ins per IP per hour (Auth → Rate Limits), CAPTCHA for sign-ins
(Auth → Attack Protection).

## Input limits

| Input           | Client             | Server                                                                       |
| --------------- | ------------------ | ---------------------------------------------------------------------------- |
| Display name    | 20 chars           | normalized, 1–20 chars; > 200 chars rejected before normalization            |
| Room code       | 5 chars            | normalized; > 64 chars → invalid code before any regex                       |
| Answer          | 100 chars          | ≤ 100 after trimming; > 400 chars rejected before normalization              |
| Answers payload | 7 known categories | unknown categories rejected; body ≤ 16 KB                                    |
| Identifiers     | —                  | typed `uuid` parameters; malformed values are rejected by PostgREST/Postgres |
| NUL bytes       | —                  | impossible in Postgres text; the request is refused                          |

Normalization semantics are unchanged (NFC, trim incl. NBSP/zero-width at the edges,
collapsed whitespace, ICU lowercase). No look-alike folding, no emoji stripping —
tested with composed/decomposed Cyrillic, zero-width characters, Latin look-alikes,
emoji and long combining sequences.

## XSS / injection

- React renders every user string as text. There is no `dangerouslySetInnerHTML`,
  `innerHTML`, `eval` or `new Function` in the codebase.
- All database access is parameterized (supabase-js / PostgREST); RPC bodies contain no
  dynamic SQL.
- Content-Security-Policy: scripts from the site itself only (plus the CAPTCHA provider
  when configured), no inline scripts, no `eval`, `frame-ancestors 'none'` — see
  `docs/deployment.md`.

## Authentication

- Anonymous sessions persist in `localStorage` and refresh automatically.
- A network failure never replaces an identity: when the stored session cannot be
  refreshed because the server is unreachable, the app waits and retries; a new
  anonymous user is created only when there is no session at all, or the server
  rejected the stored one.
- Multiple tabs share one session (one player identity).
- Expired/revoked tokens: requests fail with 401; supabase-js refreshes or the identity
  is re-established (a revoked anonymous user cannot be recovered — by design).
- CAPTCHA: see `docs/production.md`.

## Reporting a vulnerability

[OPERATOR: security contact — fill in before public launch]
