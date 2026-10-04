# SESSION developer dashboard

`/developer` gives an explicitly selected operator a read-only overview of SESSION's existing records. An authorized account also sees **Developer dashboard** under the workspace's More navigation. Requests to `/api/developer` use the same server access check; knowing the URL does not grant access.

## Access

Set the server-only `SESSION_DEVELOPER_IDS` variable to a comma-separated list of immutable, authenticated account IDs. For Vercel these are Neon Auth user IDs; for Sites these are trusted dispatcher user IDs. Leave it empty to disable access. Store production configuration in encrypted hosting variables and local configuration in ignored `.env*` files. Never use `NEXT_PUBLIC_`, editable creator roles, names, usernames, or email addresses as authorization.

Resolve a requested operator's account against the correct provider and production branch. An email lookup alone does not prove control of an unverified account: verify the intended signed-in account before enrollment. Do not commit real operator IDs or emails. Removing an ID revokes subsequent page/API requests after the hosting configuration is deployed; it does not delete that account or its music.

Signed-in visitors without dashboard access can expand **Signed-in account details** on the access screen to see their own server-confirmed account ID. Guests see no ID, and the panel does not expose configured operator IDs or another account's information. Use this panel to confirm the intended account before changing the allowlist.

The API returns `private, no-store` on success and failure. Guests receive 401; other accounts receive 403 before dashboard queries run. The client discards prior data while reloading and on failed or denied requests. A page already in an operator's browser is a snapshot; use refresh or navigate again to check current access. No route bypasses existing private project, file, or conversation authorization.

## Metrics

- **Visitors today** estimates distinct foreground browsers, including guests, during the current UTC day. **Daily active users today** counts distinct verified signed-in accounts with a foreground visit or interaction, including accounts without creator profiles. The Audience section includes fourteen UTC days; dates before collection began are marked Not measured. See [collection, privacy, deployment and limits](DAILY_ACTIVITY.md).
- **Creator profiles** counts SESSION profiles, including private profiles. It is not the number of all authentication accounts; an account can exist without a creator profile.
- **New profiles** uses profile creation timestamps. The chart covers the last fourteen calendar days in UTC, including the current partial day. Seven-day counts use a rolling interval.
- **Recorded active creators** counts distinct profiled accounts with a qualifying record in the last seven days: profile creation, latest project update, track/post/comment/room creation, or room presence. The latest project editor is used when recorded. This is a signal from current records, not visits, logins, retention, or a complete historical activity log. Deleted records and overwritten latest-update timestamps can change it.
- **Community tracks** counts database tracks by current public/private visibility. The built-in SESSION Originals catalog is separate.
- **Room presence** counts distinct participants with member heartbeats from the last thirty seconds in existing rooms. It is not a count of everyone online across the website. Invitation expiry does not end existing membership; closed/deleted rooms and stale heartbeats do not count.
- **Projects, posts, files, media bytes, and reports** describe current stored metadata. Reports have no resolution status, so the dashboard labels their total, not pending reports. Media bytes sum tracked file sizes; they are not a provider storage bill or an independent object-bucket inventory.
- **Database reachability and query time** describe this dashboard request. Vercel logs and traffic links open the hosting dashboard, which has its own account access. SESSION mounts `@vercel/analytics/next` once in the root layout on Vercel builds to record page views. Query strings, invitation fragments, and URL credentials are removed with `beforeSend`; no custom events or account identifiers are added. Sites builds do not mount the Vercel tracker. Web Analytics must also be enabled for the Vercel project and deployed before traffic appears; the dashboard link itself does not enable it. See [Vercel setup](https://vercel.com/docs/analytics/quickstart) and [URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data).

The user list contains only account IDs, names, usernames, profile visibility/creation time, and counts of projects/tracks. It never includes email addresses, bios, locations, private titles or content, conversations, invitation tokens, file IDs, plugin state, credentials, or payment details. Search matches literal name/username text and uses bounded pagination.

## Verification

Daily audience acceptance (October 3, 2026): all 47 offline suites, TypeScript, scoped lint, both builds, real PostgreSQL rollback checks, independent review and credential scans passed. Production deployment `dpl_27kBdzadua8nB51nymAZNW4bnM3J` is READY. Signed-in profileless activity, repeat-visit deduplication, fourteen UTC days, mobile layout and live denial checks passed. Collection began October 4 UTC (October 3 local); prior dates are unmeasured. See [complete measurement acceptance](DAILY_ACTIVITY.md).
Web Analytics acceptance (October 3, 2026): `@vercel/analytics` 2.0.1 passed 15 URL-redaction assertions, all 45 offline suites, TypeScript, scoped lint, both production builds, independent review, and a source/client credential scan. Production deployment `dpl_9Au67nunAF5W3UugWpEpPdw77YTV` is READY from source `e5121326876d0afa9b691e779b36b150953fdd85`. The live browser loaded one Next.js tracker with no console errors; Vercel's production page-view metric received both the landing visit and client navigation to `/app`. Four guest-access and fourteen landing/workspace HTTP checks passed after deployment. Evidence is in ignored `outputs/analytics-evidence`.

`tests/developer-checks.mjs` exercises the actual access check, route, and SQLite queries with disposable local fixtures. `tests/developer-harness.html` uses the actual dashboard with synthetic response controls for pagination, mobile layout, access loss, outages, and responses arriving after cancellation. Production SQL must also be checked through the PostgreSQL translation layer; read-only `EXPLAIN` can verify query compatibility without copying private rows into test evidence.

Release acceptance should record both builds, independent review, denied guest/non-operator access, authorized operator access, and the live More navigation link. Evidence belongs under ignored `outputs/developer-evidence`. No production users, songs, or messages are changed by this dashboard.

For read-only Vercel/Neon guest acceptance, set `SESSION_VERIFY_BASE` to the selected deployment and run `node tests/developer-http-checks.mjs`. This checks guest denial, rejection of forged dispatcher headers, private/no-store API responses, the sign-in page, and hidden operator navigation. It does not prove authorized operator access.

### October 3, 2026 acceptance

- TypeScript, scoped lint, all 44 offline suites, and both Sites and Vercel production builds passed.
- The developer suite passed 258 assertions, including six access-page rendering checks. All twelve translated queries passed PostgreSQL `EXPLAIN` without reading private rows; UTC bucket and literal search compatibility checks passed.
- Ten browser checks passed with synthetic data, covering search/pagination, a shrinking last page, late cancelled responses, sign-out/access loss, database failure, a 390px viewport, and a fresh load without console errors.
- Independent review found a last-page refresh defect when profiles disappeared. The regression and fix passed; review confirmed no remaining medium or high findings.
- Initial deployment `dpl_6zacDySHQJDBhE9q3UkyRQV79Qz1` shipped with access disabled. An upload server error was resolved with an archive retry; subsequent builds used the exact reviewed GitHub commit without changing repository links.
- Current production deployment `dpl_AmPgn5hi5F4Zenn4PzxRUMYHfA8P` is READY at [SESSION](https://session-site-eosin.vercel.app), from source commit `3c2b231ab09fd17712425f690f5bba4c54a345ce`. The selected operator was enrolled only after the normal signed-in access page's server-confirmed account ID exactly matched the selected Neon ID. The variable is sensitive and production-only; no real account ID or email is committed.
- Authorized metric loading, manual refresh, and **More → Developer dashboard** passed in the signed-in browser. Four guest/forged-header checks and fourteen landing/workspace checks passed after activation. Guests see no account-details ID. The identity panel passed fresh independent review with no medium or high findings.
- Source/client-build credential scans and a separate operator-ID disclosure scan passed. Email verification status and provider authentication roles were not modified.
