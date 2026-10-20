# Release checklist — Web v1.0

Tick every box on **staging** first, then again on production. Items marked
**(manual)** cannot be verified by the automated suites.

## Infrastructure

- [ ] Hosted Supabase project created (region chosen), database password stored safely
- [ ] Migrations applied with `supabase db push`; function/grant check from `docs/production.md` §2 passes
- [ ] `pgrst.db_pre_request = private.check_request` present on `authenticator` (rate limits active)
- [ ] Anonymous sign-ins enabled; anonymous sign-in rate limit per IP set
- [ ] CAPTCHA enabled in Supabase (secret key) and `VITE_CAPTCHA_PROVIDER` / `VITE_CAPTCHA_SITE_KEY` set for the build
- [ ] API exposes `public` only (no `graphql_public`, never `private`)
- [ ] Realtime: public access disabled (private channels only)
- [ ] `pg_cron` enabled; `cleanup-expired-data` job listed and a run succeeded
- [ ] Frontend built with `npm ci && npm run build` from a clean checkout; `npm run scan:secrets` passes
- [ ] Frontend deployed; SPA fallback works (`/room/ABCDE`, `/privacy`, `/about` load directly)
- [ ] HTTPS only (HTTP redirects), HSTS present
- [ ] Security headers present (CSP, nosniff, Referrer-Policy, frame protection, Permissions-Policy) — check with the browser devtools / `curl -I`
- [ ] No CSP violations in the console during a full game

## Functional (staging, real network)

- [ ] Create a room; join from a second and third browser identity
- [ ] 3 players: READY → countdown → letter → timer counts down identically
- [ ] Answers autosave ("Запазено"), survive a refresh, lock with ГОТОВ
- [ ] Early finish (everyone ready) and timeout both reach RESULTS_READY
- [ ] Results reveal synchronized on all screens; scores correct
- [ ] Host invalidates an answer; scores and leaderboard update everywhere
- [ ] Next round; history browsing
- [ ] Host closes the tab → after ~45 s another player becomes host and can continue
- [ ] A player leaves and rejoins (same name, same seat)
- [ ] Play to FINISHED (or accelerate on staging only) — winner and final standings
- [ ] Fair play: switching apps during a round shows "извън играта" to others
- [ ] Sound plays after the first tap; mute persists after reload
- [ ] Rate limits: normal play never shows "Твърде много заявки"

## Devices **(manual)** — see `docs/device-test-plan.md`

- [ ] Desktop Chrome
- [ ] Desktop Firefox
- [ ] Desktop Safari (macOS)
- [ ] Android Chrome (real device)
- [ ] iPhone Safari (real device)

## Privacy / security

- [ ] Operator name and contact filled in on the privacy page (`src/app/pages/PrivacyPage.tsx`) and the security contact in `docs/security.md`
- [ ] Privacy page reviewed by the operator (not legal advice); hosting/monitoring providers listed if added
- [ ] No secrets in the deployed bundle (`npm run scan:secrets` on the exact build that is deployed)
- [ ] CI green: quality job and database job (pgTAP incl. security catalog, integration incl. security suite)
- [ ] Rate limits verified on staging (e.g. 11 quick room creations from one browser → the 11th is refused)

## Operations

- [ ] Monitoring decided: either a telemetry sink registered (provider documented in the privacy page, origin in CSP) or explicitly none
- [ ] Dashboard log access and alert contacts set up (Postgres errors, Auth errors, Realtime)
- [ ] Rollback understood: previous frontend deploy can be restored; database is fix-forward only
- [ ] Staging smoke test passed on the release build

Release: **Web v1.0** (`package.json` version `1.0.0`).
