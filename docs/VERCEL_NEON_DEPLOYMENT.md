# Vercel and Neon deployment

SESSION has two deployment targets. `npm run build` retains the Sites/Vinext Worker, trusted dispatcher identity, D1, and R2. `npm run build:vercel` builds Next.js for Vercel, with server-verified Neon Auth cookies, PostgreSQL, and private Neon storage. The targets use separate build directories: `.next` and `.vercel-next`. `vercel.json` explicitly selects `.vercel-next` for deployment packaging. `.env.local` cannot switch the Sites build to the Vercel identity model.

## Resources

- GitHub repository: `Doughboyfressh/session-site`.
- Vercel project: `session-site`; assigned production domain: `session-site-eosin.vercel.app`.
- Neon project: `shy-bird-83273732`.
- Isolated Neon branch: `session-production` (`br-polished-mode-auigm3oy`).
- Fresh application database: `session`; private bucket: `session-files`.

## Verified deployment — October 1, 2026

Production is available at [session-site-eosin.vercel.app](https://session-site-eosin.vercel.app). Vercel deployment `dpl_FTbVD5b42iibLiiv1sBGvKQNeuZz` is Ready, built from Git SHA `aa1cc55` after merged application SHA `f6e357e`. Its immutable URL is `https://session-site-a7a5ayn5a-doughboyfressh.vercel.app`. All 12 approved production variables were stored encrypted.

Seven live smoke checks and 32 actual production Auth/PostgreSQL/private-storage checks passed, including signed sessions, a 6 MiB chunked upload, authorized range reads, cross-account rejection, project persistence, and room updates. Homepage and sign-in browser checks had no console errors. Disposable fixtures were cleaned; no existing application data was migrated. Evidence is in ignored `outputs/production-smoke.json`, `outputs/deployment-result.json`, and the earlier validation directories.

The deployment was made through the authenticated CLI. Automatic deployment from GitHub pushes is not connected; enabling it requires repository integration access. Vercel's existing deployment protection remains enabled, and the assigned production alias serves the application.

The Neon parent's existing application data is preserved. This deployment starts with an empty SESSION database and separate Neon accounts. Existing Sites accounts, uploads, and project data are not copied. Vercel access protection and Sites access restrictions are separate provider settings; deploying does not establish approval for a public launch.

## Configuration

Use Node 24 and the committed lockfile. Copy the blank variables from `.env.example` into ignored `.env.local` for local checks. Configure the same server-only values as encrypted production variables in Vercel. Cookie secrets must have at least 32 characters. `DATABASE_URL` points at the isolated database. The S3 endpoint and credential are scoped to the Neon branch. Set `APP_URL` to the assigned HTTPS origin and allow that exact origin in Neon Auth. TURN credentials remain server-only and support authorized room members.

`scripts/configure-vercel-env.mjs` reads the linked `.vercel/project.json` and copies only its explicit allowlist to production. Pass the installed Vercel CLI entry point as its argument. It does not transfer the Vercel login token or Stripe credentials. Its temporary input file is excluded from Git and deployment uploads and removed after the request. Reconfigure its fixed `APP_URL` when using a different domain.

For a fresh database only, `npm run db:migrate:neon` applies `deploy/001-session-postgres.sql` followed by `deploy/002-session-activity.sql` in one transaction. The schema generator derives the initial PostgreSQL schema from the append-only SQLite migrations; it is not a data migration or an upgrade runner. For an existing SESSION database, `npm run db:migrate:activity:neon` applies only the additive activity table. Never reapply initialization as an upgrade or apply it to another application's database. Configure server-only `SESSION_ACTIVITY_SECRET` for daily measurement; see [visitor and daily active user definitions](DAILY_ACTIVITY.md).

The PostgreSQL adapter translates the application's bounded SQLite query forms and preserves transaction atomicity. It uses serializable transactions with bounded serialization/deadlock retries. When adding raw SQL, add a deployment regression and verify it against PostgreSQL; SQLite fixtures alone cannot validate this adapter.

## Uploads and identity

Vercel uploads use authenticated 3 MiB requests so supported audio and video files fit the function request-body limit. Server-owned upload sessions serialize writes, completion, and cancellation. Completion invokes the existing upload validation and permissions. Object access still passes through authorized SESSION routes; the bucket is private. Abandoned sessions expire after 15 minutes and are cleaned opportunistically on a later upload start. No scheduled cleanup job is configured.

Sign-in uses Neon Auth at `/auth/sign-in`, with safe relative return paths. The legacy sign-in route redirects into this flow on Vercel. Sites identity headers supplied by a browser are ignored by the Vercel target. Sign-in cookies and backend credentials never enter the browser bundle.

## Verification

Run `npm test`, `npm run typecheck`, and both build commands. `tests/deployment-checks.mjs` is included in the normal suite and checks SQL translation and redirect sanitation.

For real backend verification, start the built Vercel runtime on port 3101 and run:

```sh
npm run start:vercel -- -p 3101
node --env-file=.env.local tests/deployment-http-checks.mjs
```

The HTTP check creates two disposable accounts under `example.invalid`, uploads a generated 6 MiB WAV, verifies private/range access, saves a project, and updates a room. It cleans only its own database fixtures and uploaded originals. If provider account deletion is disabled, it records the synthetic IDs in ignored `outputs/deployment-test-accounts.json`; delete those exact users through Neon Auth administration. Do not run these synthetic checks against an unrelated database.

October 1 validation passed 32 actual Neon Auth/PostgreSQL/private-storage checks, the existing 26 test suites, the deployment regressions, TypeScript, and both production builds. A fresh independent review found no remaining high or medium findings after the fixes. Dependency audit has four moderate findings in the legacy Drizzle/esbuild tooling chain and no high or critical findings. Broader real-device, TURN, moderation, privacy operations, and release acceptance remain in [production readiness](PRODUCTION_READINESS.md).

Deploy with the authenticated Vercel CLI after configuring production variables. Record the Git SHA and Vercel deployment ID, check `/api/state` and sign-in, and verify that forged identity headers remain unauthorized on the production origin. CLI deployment can work without a GitHub app connection; automatic deployments on pushes require the Vercel GitHub app to have access to this repository. A code rollback does not restore database writes or deleted objects.
