# Operations — Web v1.0

## Observability (privacy first)

The app sends **nothing** to third parties by default. There is a single integration
boundary, `src/shared/lib/telemetry.ts`:

- `reportError(kind, error, context)` is called for: React render errors (top-level
  error boundary and route errors), unhandled errors and promise rejections, unexpected
  RPC failures (anything that is not a whitelisted game error or offline), refused
  anonymous sign-ins, and Realtime channel failures.
- Every report is **sanitized**: no tokens/keys, no UUIDs, no room codes, no quoted user
  text (answers, names), max 300 characters; identical reports are throttled to one per
  minute.
- To enable monitoring, register a sink once in `src/main.tsx`:

  ```ts
  import { setTelemetrySink } from './shared/lib/telemetry';
  setTelemetrySink((event) => {
    // e.g. navigator.sendBeacon('https://your-endpoint', JSON.stringify(event));
  });
  ```

  Choose a provider deliberately (it receives the visitor's IP address), document it in
  the privacy page, and add its origin to the CSP `connect-src`.

Production console output: development-only diagnostics; no tokens or user content are
logged.

### Server-side signals (Supabase dashboard / SQL)

| Question                      | Where / query                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database errors, slow queries | Dashboard → Logs → Postgres; Reports → Query performance                                                                                                                 |
| Auth failures (incl. CAPTCHA) | Dashboard → Logs → Auth                                                                                                                                                  |
| Realtime problems             | Dashboard → Logs → Realtime                                                                                                                                              |
| Abnormal room creation        | `select date_trunc('hour', created_at) h, count(*) from rooms group by 1 order by 1 desc limit 24;`                                                                      |
| Who is hitting rate limits    | `select op, count(*) filter (where hits > r.max_requests) as over, max(hits) from private.rate_limit_counters c join private.rate_limit_rules r using (op) group by op;` |
| Active games right now        | `select phase, count(*) from rooms where updated_at > now() - interval '15 minutes' group by 1;`                                                                         |
| Cleanup ran                   | `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'cleanup-expired-data') order by start_time desc limit 5;`                 |

Suggested alerts: Postgres error rate, Auth error spikes, rooms created per hour above
a chosen threshold, cleanup job failures.

## Retention and cleanup

`private.cleanup_expired_data()` runs hourly (`pg_cron`, job `cleanup-expired-data`).

| Data                          | Deleted when                                   | Why this value                                                       |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Rooms never started (LOBBY)   | 24 h after the last sign of life of any member | Friends who planned a game for later the same day keep their room    |
| Abandoned games (in progress) | 24 h after the last sign of life of any member | A game interrupted by a long break can still be resumed the same day |
| Finished games                | 7 days after `finished_at`                     | Players can revisit results for a week                               |
| Rate-limit counters           | 2 h                                            | Windows are ≤ 10 min                                                 |
| Anonymous users with no room  | 30 days after their last sign-in               | Keeps auth.users from growing unbounded                              |

"Sign of life" = the newest of the room's `created_at`, `updated_at` and every member's
`last_seen_at` (heartbeats every 15 s while anyone has the room open). Deleting a room
cascades to every round, answer sheet, answer, ready check, visibility event and
invalidation event — no orphans (tested).

Safety: each candidate room is locked with `FOR UPDATE SKIP LOCKED` (a room in active
use is never waited on) and its expiry is re-checked under the lock. Heartbeats take
the same lock, so a player reconnecting at the last moment always wins the race. At most
500 rooms and 1000 users are processed per run.

Change retention by redefining `private.retention_*()` in a new migration.

## Request volume (expected)

Per connected client, steady state:

- heartbeat every 15 s → 4/min, each followed by reconciliation reads (room summary for
  phase/host, plus the roster in the lobby or the game state in a game) → 4/min. **8 requests/min/client**, i.e. ~120/min for a
  15-player room.
- Plus refetches triggered by realtime events (a ready/lock/phase change → one
  `get_game_state` per client), autosaves while typing (≤ 2/s per typing player, 500 ms
  debounce), and the reveal (one `get_round_results` per client per round).

The 15-second reconciliation is a safety net for lost realtime events (observed
locally: a burst of joins was not delivered). It is intentionally kept; it costs about
4 cheap reads per client per minute.

## Database growth (measured)

A full 15-player, 28-round game (local fixture, all 7 answers filled, one visibility
event per third player per round): 2,940 answers = 270 kB of row data / **768 kB with
indexes**; 420 answer sheets = 152 kB with indexes; 140 visibility events = 16 kB; 28
rounds ≈ 3 kB; plus ~840 ready checks (~100 kB). In total roughly **1–1.2 MB per full
game**, ≈ 40 kB per 15-player round. With 7-day retention for finished games and 24 h for abandoned
ones, storage is bounded by the number of games in the last week: e.g. 1,000 full games a
week ≈ 1.5 GB at most, usually far less (most games are shorter or smaller).

## Performance baseline (local stack, reference machine)

| Measurement                                      | Value                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| JS entry chunk                                   | 137 kB (40 kB gzip) + React 312 kB (98 kB gzip) + Supabase 214 kB (55 kB gzip) + Query 35 kB (10 kB gzip) |
| CSS                                              | 59 kB (10.7 kB gzip)                                                                                      |
| Fonts                                            | 16 WOFF2 files, 240 kB total (only used subsets are fetched)                                              |
| Audio assets                                     | 0 bytes (synthesized)                                                                                     |
| `save_answers`, 15 players typing                | p50 13 ms, p95 47 ms                                                                                      |
| `get_game_state`, 15 concurrent                  | p50 35 ms, p95 40 ms                                                                                      |
| `get_round_results`, 15 concurrent (round 1)     | p50 68 ms, p95 98 ms                                                                                      |
| `get_round_results`, round 28 of 28 (15 players) | 33 ms (was 234 ms before the v1.0 standings optimization)                                                 |
| `get_game_summary`, 28 rounds                    | 19 ms (was 217 ms)                                                                                        |
| Timer re-renders                                 | once per second, only the timer component                                                                 |

Use these as regression references, not as hosted-latency predictions.

## Known local-development limitations

- Docker Desktop on WSL2: the database clock can run ~7 % fast with periodic ~1.7 s
  corrections, and step back after restarts. Tests that simulate time use generous
  margins and server timestamps; diagnostics print server time.
- Docker needs several GB of free disk space for the Supabase images; with a nearly full
  system drive, Docker Desktop can fail to start or report I/O errors.
