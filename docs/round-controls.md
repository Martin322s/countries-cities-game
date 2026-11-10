# Round controls

The existing architecture is retained, with AI validation integrated after READY:

`ROUND_WAITING → COUNTDOWN → PLAYING → RESULTS_READY → AI_VALIDATING → REVEAL → RESULTS`.

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
3. `20261013000000_ai_validation.sql`: AI phase, validation status/reasons and audit table.
4. `20261014000000_ai_round_control_integration.sql`: ready barrier, worker timeout and audit RLS.
5. `20261014010000_ai_validation_worker.sql`: privileged job claims/completion, scoring and fallback flag.

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

## AI phase and deployment

All required READY confirmations enter `AI_VALIDATING`. A member can wake the Edge
Function `validate-round-answers` using only room and round IDs. It verifies the JWT
and active room membership, then obtains the locked letter and answers through a
service-only RPC. Client-provided answer text and model-provided player identities
are never trusted. The model receives answer indices, categories, values and the
letter, without player names, room codes or authentication identifiers.

The worker uses a strict JSON schema with required nullable fields, following
[official OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
It rejects missing, duplicate or foreign decisions and preserves the original text.
Wrong-letter decisions are checked locally as well. The backend requires a complete
batch for the exact round and job claim before changing scores and starting REVEAL.
INVALID answers score zero and do not create duplicate groups; the existing host
invalidation rules still apply independently.

Only one worker can claim a round at a time, with a 90-second lease and at most three
attempts. Each model request times out at 45 seconds. After 180 seconds in the AI
phase, the existing heartbeat/read mechanism marks still-unverified answers INVALID
with reason AMBIGUOUS and continues to REVEAL. The UI explicitly reports this
fallback. Late worker completions cannot overwrite the fallback or a newer job.
Audit rows remain private until reveal. Validation RPCs are service-only; there is
no extra authenticated SQL write or transition surface.

Before deploying the frontend, apply all five migrations and deploy
`supabase/functions/validate-round-answers`. Configure `OPENAI_API_KEY` as a Supabase
Edge Function secret, with optional `OPENAI_MODEL` (default `gpt-4.1-mini`).
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by the Edge runtime.
Secrets must stay on the server. For local work, serve the function with an ignored
environment file based on `supabase/functions/.env.example`; the existing `db:start`
script excludes Edge Runtime, so serve the function separately.

Tests simulate provider responses and trusted completion without paid requests.
Actual model accuracy, deployed function/JWT configuration and mobile browser events
still require staging/device verification. The SQL and Realtime integration suites
require Docker/Podman and a local Supabase stack.

## Verification in this workspace

- `npm run check`: passed, 378 tests in 43 files, including typecheck, lint and formatting.
- Production build and secret scans: passed.
- Supabase integration: 49 tests skipped because no local stack is configured.
- Database migrations, pgTAP, Realtime delivery and live OpenAI calls remain unverified here; Docker/Podman is unavailable.

## Changed files

- `.env.example`
- `.prettierrc.json`
- `README.md`
- `docs/round-controls.md`
- `eslint.config.js`
- `package-lock.json`
- `package.json`
- `src/app/pages/AboutPage.tsx`
- `src/app/pages/PrivacyPage.tsx`
- `src/domain/activity.test.ts`
- `src/domain/config.ts`
- `src/domain/index.ts`
- `src/domain/phases.test.ts`
- `src/domain/phases.ts`
- `src/domain/round.test.ts`
- `src/domain/round.ts`
- `src/domain/validation.test.ts`
- `src/domain/validation.ts`
- `src/features/game/GameScreen.tsx`
- `src/features/game/activity/activityUi.test.tsx`
- `src/features/game/activity/tabVisibilityMonitor.test.ts`
- `src/features/game/activity/tabVisibilityMonitor.ts`
- `src/features/game/activity/useVisibilityReporter.ts`
- `src/features/game/api/activity.ts`
- `src/features/game/api/gameApi.ts`
- `src/features/game/api/gameState.test.ts`
- `src/features/game/api/gameState.ts`
- `src/features/game/api/roundResults.ts`
- `src/features/game/components/AiValidationScreen.test.tsx`
- `src/features/game/components/AiValidationScreen.tsx`
- `src/features/game/components/AnswerForm.tsx`
- `src/features/game/components/GameScreens.test.tsx`
- `src/features/game/components/PlayingScreen.tsx`
- `src/features/game/components/PostRoundScreen.tsx`
- `src/features/game/components/results/ResultsTable.tsx`
- `src/features/game/gameCues.test.tsx`
- `src/features/game/hooks/useAnswerDraft.ts`
- `src/features/game/serverLag.ts`
- `src/features/lobby/RoomPage.tsx`
- `src/shared/lib/database.types.ts`
- `src/test/aiValidationProtocol.test.ts`
- `src/test/aiValidationWorker.test.ts`
- `src/test/integration/chaos.integration.test.ts`
- `src/test/integration/fullGame.integration.test.ts`
- `src/test/integration/gameplay.integration.test.ts`
- `src/test/integration/helpers.ts`
- `src/test/integration/load.integration.test.ts`
- `src/test/integration/results.integration.test.ts`
- `src/test/integration/roundControls.integration.test.ts`
- `src/test/integration/visibility.integration.test.ts`
- `supabase/README.md`
- `supabase/functions/.env.example`
- `supabase/functions/deno.d.ts`
- `supabase/functions/tsconfig.json`
- `supabase/functions/validate-round-answers/deno.json`
- `supabase/functions/validate-round-answers/index.ts`
- `supabase/functions/validate-round-answers/protocol.ts`
- `supabase/migrations/20261012000000_round_control_reasons.sql`
- `supabase/migrations/20261012010000_round_controls.sql`
- `supabase/migrations/20261013000000_ai_validation.sql`
- `supabase/migrations/20261014000000_ai_round_control_integration.sql`
- `supabase/migrations/20261014010000_ai_validation_worker.sql`
- `supabase/tests/database/ai_validation.test.sql`
- `supabase/tests/database/gameplay.test.sql`
- `supabase/tests/database/multi_round.test.sql`
- `supabase/tests/database/results.test.sql`
- `supabase/tests/database/visibility.test.sql`
- `supabase/tests/helpers/ai_validation.sql`
- `supabase/tests/helpers/three_player_round.sql`

The initial package-lock.json and public .env.example changes are included at the user's request. Private environment files remain ignored.
