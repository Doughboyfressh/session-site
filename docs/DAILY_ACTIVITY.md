# SESSION visitor and daily active user measurement

The private developer dashboard's Audience section measures foreground SESSION usage independently of creator profiles and Vercel Web Analytics. Its existing immutable-account authorization remains required to read these counts.

## Definitions

- **Visitors today** estimates distinct browsers seen on a visible SESSION page during the current UTC calendar day, including guests and signed-in people. A server-issued, signed, HttpOnly first-party cookie deduplicates that browser within the day. Clearing or blocking cookies, using multiple browsers, and simultaneous first visits in separate tabs can affect this estimate; it is not an exact count of humans.
- **Daily active users today** counts distinct verified signed-in accounts with a foreground page visit or interaction during the current UTC day. Accounts without a saved creator profile count. A hidden tab or background server request alone is not activity.
- **Daily history** covers fourteen UTC calendar days, including the current partial day. Dates before the earliest recorded activity are marked Not measured. Historical visits, logins, creator records, and previous Vercel events are not reconstructed into these counts.

## Collection

`SessionActivity` mounts once from the shared root layout. It records visible entry/navigation and listens for visibility, focus, pointer, keyboard, and scroll events. Interactions are throttled to five minutes; a new UTC day can record immediately. Requests within a tab are serialized so the visitor cookie is established before rapid navigation records again. StrictMode cleanup cancels the initial timer, and failed requests have a one-minute retry delay. There is no idle heartbeat that fabricates activity for an unattended tab.

The client sends a bodyless same-origin `POST /api/activity`. The server obtains the account from the verified session, signs the daily browser identifier, and inserts distinct visitor/account measurements atomically. The browser does not supply an account ID or activity date. Duplicate pings and established-cookie tabs do not increment a day's unique counts.

Daily, domain-separated HMAC digests are stored in `activity_daily`; raw account IDs, browser identifiers, emails, IP addresses, user agents, visited URLs, room/project IDs, search text, music, and messages are not recorded. Measurements do not grant room, file, project, or operator access. Tracking errors do not block the music application. Activity configuration or database failures have an explicit unavailable state rather than fabricated zero counts.

## Deployment

Apply the new append-only SQLite migration through the existing Sites migration flow. For an existing SESSION PostgreSQL database, apply only `deploy/002-session-activity.sql` with the activity migration script; `deploy/001-session-postgres.sql` remains the fresh-database initialization and must not be reapplied to upgrade an existing installation.

For a fresh PostgreSQL database, `npm run db:migrate:neon` now applies initialization and the activity migration together. For an existing database, use `npm run db:migrate:activity:neon`, with the intended database URL in ignored `.env.local`.

Configure a stable, server-only `SESSION_ACTIVITY_SECRET` of at least 32 characters in encrypted hosting variables. Vercel can use the existing `NEON_AUTH_COOKIE_SECRET` as a domain-separated fallback. Sites requires the dedicated secret when the fallback is absent. Missing or malformed configuration disables measurement and is shown as Not configured. Do not expose either key through `NEXT_PUBLIC_` variables. Changing the measurement key during a day can change deduplication; keep it stable for consistent counts.

Counts begin after deployment and the first measured visit. This release adds no automatic erasure of historical measurement rows or changes to account deletion, authentication roles, existing projects, or Vercel analytics settings. The new rows are private telemetry; any future retention policy must cover them explicitly.

## Verification

Run `tests/activity-checks.mjs` for the real route, signed-cookie and database behavior, and `tests/foreground-activity-checks.mjs` for the actual client lifecycle and foreground scheduling. The developer harness supplies measured history, no-history, unavailable, and malformed-response cases. Release acceptance includes SQLite and PostgreSQL compatibility, guest/forged-header rejection, repeated-cookie deduplication, profileless verified activity, UTC rollover, mobile browsing, both production builds, independent review, and signed-in live dashboard verification. Evidence stays under ignored `outputs/activity-evidence`.

October 3, 2026 preflight passed TypeScript, scoped lint, all 47 offline suites, and both Sites and Vercel production builds. The activity suite passed 266 assertions and developer suite 289. The actual client lifecycle check covers StrictMode cleanup, serialized navigation, foreground-only collection, failure backoff, and a held request across UTC midnight. Browser fixtures passed desktop, 390px layout, accessible daily history, no-history/configuration/outage states, and five malformed responses, with no console errors. A fresh independent reviewer confirmed the midnight fix and reported no remaining high or medium findings. The source/client-build credential scan checked eight secret values across 530 files and found no disclosures.

Real PostgreSQL acceptance passed 64 assertions and 28 translated activity queries against the selected SESSION production branch, using synthetic verified-session fixtures inside a rollback-only transaction with an empty temporary table. Guest collection, profileless DAU, cookie deduplication, UTC rollover, aggregates and migration constraints passed. Rollback succeeded and the catalog confirmed the originally absent production activity table remained absent; no fixtures or schema changes persisted from this check.

Production acceptance: deployment `dpl_27kBdzadua8nB51nymAZNW4bnM3J` is READY from source `abe7997c519eba38f40ac3140dd8941cd559dd9d` at [SESSION's developer dashboard](https://session-site-eosin.vercel.app/developer). Only the additive forward migration was installed on the selected `session-production` branch, with a dedicated sensitive production activity key. The signed-in verification visit recorded one visitor and one DAU despite zero creator profiles. Manual refresh, reload and a second browser tab retained those counts; these are verification activity, not evidence of organic growth. The 14-day table showed thirteen unmeasured prior dates and the current UTC day. Live 390px browsing had no horizontal overflow and the viewport was restored.

Four developer guest/forged-header checks, fourteen landing/workspace checks and five activity protocol rejection checks passed. The rejection checks issued no measurement cookies or writes. Browser console errors were absent. A bounded ten-minute Vercel error-level scan returned two known `pg-connection-string` SSL-mode warnings attached to successful HTTP 200/204 responses, and no HTTP 5xx responses; this is not a claim that all historical runtime logs are clean. Safe evidence and screenshots are under ignored `outputs/activity-evidence`.
