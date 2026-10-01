# SESSION — project memory

SESSION is a browser music studio with private projects, community features, and invite-only rooms. It supports Sites and Vercel/Neon deployment targets. Release acceptance and operational limitations are documented in `docs/PRODUCTION_READINESS.md`.

## Commands

- `npm test` runs offline suites and writes evidence to `outputs/release-checks`.
- `npm run typecheck` checks TypeScript.
- `npm run build` builds Sites; `npm run build:vercel` builds Next.js for Vercel.
- `tests/deployment-http-checks.mjs` verifies an explicitly configured Neon backend using disposable fixtures; see `docs/VERCEL_NEON_DEPLOYMENT.md`.

## Architecture

- Sites uses trusted dispatcher identity, D1, and R2. Vercel uses verified Neon Auth sessions, PostgreSQL, and private Neon object storage through `lib/deployment`.
- SQLite migrations are append-only; `deploy/001-session-postgres.sql` initializes a fresh database only.
- Preserve authorization through SESSION file routes and keep secrets in ignored local files or encrypted hosting variables.

## Conventions

- Use `codex/` branches; document deployment changes alongside their tests.
- Keep generated builds and evidence under ignored paths.

## Lessons

- 2026-10-01 — Validate raw SQL changes against PostgreSQL as well as SQLite; nullable comparisons and upsert target references require explicit translation.
- 2026-10-01 — Select each build target explicitly, keep separate output directories, and match Vercel's outputDirectory to Next.js distDir; local Vercel environment files must not change Sites identity behavior.
- 2026-10-01 — Reject protocol-relative return paths both before and after URL normalization, and validate upload-purpose keys with own-property checks.
