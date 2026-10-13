# Round controls

The existing architecture is retained, with geographic validation integrated after READY:

`ROUND_WAITING → COUNTDOWN → PLAYING → RESULTS_READY → MAP_VALIDATING → REVEAL → RESULTS`.

The answering window is 60 seconds. `ROUND_DURATION_MS` is the frontend constant;
`round_duration()` is its authoritative SQL counterpart. STOP calls the existing
`lock_answers` RPC. The first accepted STOP locks the round and enters
`RESULTS_READY`; repeat or concurrent requests leave the timestamp unchanged.
Timeout enters the same phase and locks at `ends_at`. Neither marks anyone ready.
The existing `set_results_ready` RPC collects each participant's independent
confirmation and advances only when all required participants have confirmed.
Participants who left or whose heartbeat is older than 45 seconds are excluded,
as before. A reconnect during READY makes a fresh participant required again. After
the READY barrier has completed, validation uses the immutable round snapshot.

Saves, STOP, visibility reports and READY use the same room row lock. Answer saves
also check the sheet lock and round deadline after acquiring that lock. Direct
table writes remain denied by privileges and RLS. Existing room, answer sheet and
ready check Realtime subscriptions refresh the game state for every member.
Timeout is persisted lazily by the existing heartbeat/deadline nudge mechanism;
clients stop editing at the authoritative deadline even before that refresh.

During answering, blur, hiding or unloading a game tab closes its draft immediately.
`report_visibility` accepts an optional final answer snapshot and persists it and
the `tab_exit` sheet lock in one transaction. Duplicate reports have no effect and
focus never unlocks a sheet. The client sends a keepalive request, retries network
failures, and stores the original snapshot in sessionStorage across refreshes.
New rounds have separate sheets and storage keys. Every game tab is monitored
individually; another visible game tab does not exempt an exiting tab.

Clipboard events, paste shortcuts, paste/drop beforeinput and drag/drop are blocked
only on answer inputs. Other application inputs keep normal clipboard behavior.
These browser controls cannot prove that a modified client reported every exit,
or prevent using another device. The backend enforces a reported lock permanently.
Unloading/offline browsers cannot guarantee delivery; if STOP or timeout wins the
race, late snapshots are discarded and only already persisted answers count.
Window blur includes browser chrome, developer tools and system prompts; under the
requested rule these also lock the round. Mobile interruption handling needs real
device testing.

Deploy migrations in order:

1. `20261012000000_round_control_reasons.sql`: add `stop` and `tab_exit` enum values.
2. `20261012010000_round_controls.sql`: duration, serialized writes, global STOP,
   permanent visibility lock, optional snapshot and explicit RPC grants.
3. `20261013000000_ai_validation.sql` and the following worker migrations: historical validation
   schema, superseded by geographic-only validation.
4. `20261017040100_add_map_validating_phase.sql`: add the map-validation phase.
5. `20261017050000_geographic_only_validation.sql`: remove the AI worker and keep only
   country/city/village validation.

Separate migrations let PostgreSQL commit the enum values before functions use them.
Apply the database migrations before deploying the frontend. The old four-argument
visibility calls remain accepted through the new optional fifth argument. Older
clients' `lock_answers` calls now STOP the entire round, so update clients together
and avoid deployment during active games. Existing rounds keep their original
deadline; newly drawn rounds use 60 seconds.

Validation: `npm run check`, `npm run build`, `npm run db:test`, and
`npm run test:integration` against a local Supabase stack. Database tests cover
locks, snapshot preservation, timeout, ready barriers, privacy and round reset.
Integration tests exercise simultaneous STOP/READY, STOP versus timeout/tab exit,
stale/reconnected participants and Realtime STOP/READY/lock delivery. Frontend tests
cover clipboard events, keyboard shortcuts, immediate exit lock, duplicate events,
return behavior and retrying the original snapshot.

## Geographic validation and deployment

All required READY confirmations enter `MAP_VALIDATING`. A member can wake the Edge
Function `validate-round-answers` using only room and round IDs. It verifies the JWT
and active room membership, then obtains the locked letter and only geographic
answers through a service-only RPC. Countries are checked against the local list;
cities and villages are checked against Geoapify data from OpenStreetMap. Other
categories are never sent to a checking service and remain for the host to judge.

Only one worker can claim a round at a time, with a 90-second lease and at most three
attempts. If the map provider is still unavailable after 180 seconds, the round
continues to REVEAL without marking unverified answers invalid. Late worker
completions cannot overwrite the fallback or a newer job. Geographic validation
RPCs are service-only.

Before deploying the frontend, apply all migrations and deploy
`supabase/functions/validate-round-answers`. Configure `GEOAPIFY_API_KEY` as a
server-only Supabase Edge Function secret for city/village lookups.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the Edge runtime.
For local work, serve the function with an ignored environment file based on
`supabase/functions/.env.example`; the existing `db:start` script excludes Edge
Runtime, so serve the function separately.

Tests simulate geographic provider responses and trusted completion. Map data
accuracy, deployed function/JWT configuration and mobile browser events still require
staging/device verification. The SQL and Realtime integration suites require
Docker/Podman and a local Supabase stack.

## Verification in this workspace

- Typecheck, lint, production build, all 398 unit/component tests and the secret scan passed.
- `npm run check` stops at a pre-existing Prettier issue in `deploy/security-headers.test.ts`.
- Integration and pgTAP tests require a local Supabase stack; Docker/Podman is unavailable.
