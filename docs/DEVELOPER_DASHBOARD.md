# SESSION developer dashboard

`/developer` gives an explicitly selected operator a read-only overview of SESSION's existing records. An authorized account also sees **Developer dashboard** under the workspace's More navigation. Requests to `/api/developer` use the same server access check; knowing the URL does not grant access.

## Access

Set the server-only `SESSION_DEVELOPER_IDS` variable to a comma-separated list of immutable, authenticated account IDs. For Vercel these are Neon Auth user IDs; for Sites these are trusted dispatcher user IDs. Leave it empty to disable access. Store production configuration in encrypted hosting variables and local configuration in ignored `.env*` files. Never use `NEXT_PUBLIC_`, editable creator roles, names, usernames, or email addresses as authorization.

Resolve a requested operator's account against the correct provider and production branch. An email lookup alone does not prove control of an unverified account: verify the intended signed-in account before enrollment. Do not commit real operator IDs or emails. Removing an ID revokes subsequent page/API requests after the hosting configuration is deployed; it does not delete that account or its music.

The API returns `private, no-store` on success and failure. Guests receive 401; other accounts receive 403 before dashboard queries run. The client discards prior data while reloading and on failed or denied requests. A page already in an operator's browser is a snapshot; use refresh or navigate again to check current access. No route bypasses existing private project, file, or conversation authorization.

## Metrics

- **Creator profiles** counts SESSION profiles, including private profiles. It is not the number of all authentication accounts; an account can exist without a creator profile.
- **New profiles** uses profile creation timestamps. The chart covers the last fourteen calendar days in UTC, including the current partial day. Seven-day counts use a rolling interval.
- **Recorded active creators** counts distinct profiled accounts with a qualifying record in the last seven days: profile creation, latest project update, track/post/comment/room creation, or room presence. The latest project editor is used when recorded. This is a signal from current records, not visits, logins, retention, or a complete historical activity log. Deleted records and overwritten latest-update timestamps can change it.
- **Community tracks** counts database tracks by current public/private visibility. The built-in SESSION Originals catalog is separate.
- **Room presence** counts distinct participants with member heartbeats from the last thirty seconds in existing rooms. It is not a count of everyone online across the website. Invitation expiry does not end existing membership; closed/deleted rooms and stale heartbeats do not count.
- **Projects, posts, files, media bytes, and reports** describe current stored metadata. Reports have no resolution status, so the dashboard labels their total, not pending reports. Media bytes sum tracked file sizes; they are not a provider storage bill or an independent object-bucket inventory.
- **Database reachability and query time** describe this dashboard request. Vercel logs and traffic links open the hosting dashboard, which has its own account access. The links do not enable Web Analytics or prove it is configured.

The user list contains only account IDs, names, usernames, profile visibility/creation time, and counts of projects/tracks. It never includes email addresses, bios, locations, private titles or content, conversations, invitation tokens, file IDs, plugin state, credentials, or payment details. Search matches literal name/username text and uses bounded pagination.

## Verification

`tests/developer-checks.mjs` exercises the actual access check, route, and SQLite queries with disposable local fixtures. `tests/developer-harness.html` uses the actual dashboard with synthetic response controls for pagination, mobile layout, access loss, outages, and responses arriving after cancellation. Production SQL must also be checked through the PostgreSQL translation layer; read-only `EXPLAIN` can verify query compatibility without copying private rows into test evidence.

Release acceptance should record both builds, independent review, denied guest/non-operator access, authorized operator access, and the live More navigation link. Evidence belongs under ignored `outputs/developer-evidence`. No production users, songs, or messages are changed by this dashboard.

For read-only Vercel/Neon guest acceptance, set `SESSION_VERIFY_BASE` to the selected deployment and run `node tests/developer-http-checks.mjs`. This checks guest denial, rejection of forged dispatcher headers, private/no-store API responses, the sign-in page, and hidden operator navigation. It does not prove authorized operator access.

### October 3, 2026 acceptance

- TypeScript, scoped lint, all 44 offline suites, and both Sites and Vercel production builds passed.
- The developer suite passed 252 assertions. All twelve translated queries passed PostgreSQL `EXPLAIN` without reading private rows; UTC bucket and literal search compatibility checks passed.
- Ten browser checks passed with synthetic data, covering search/pagination, a shrinking last page, late cancelled responses, sign-out/access loss, database failure, a 390px viewport, and a fresh load without console errors.
- Independent review found a last-page refresh defect when profiles disappeared. The regression and fix passed; review confirmed no remaining medium or high findings.
- Production deployment `dpl_6zacDySHQJDBhE9q3UkyRQV79Qz1` is READY at [SESSION](https://session-site-eosin.vercel.app), from source commit `28c8e5a1916801bb4840c0326cc2b67b43bf2504`. Four live guest/forged-header checks and fourteen landing/workspace checks passed. Production allowlist metadata confirms that no developer variable is configured. An upload server error was resolved by retrying the same source with an archive; no hosting permissions changed.
- Source and client-build credential scans passed. Production operator enrollment and the authorized live dashboard/navigation checks remain pending proof of control of the selected signed-in account. The requested account's email was unverified at lookup; it has not been enrolled based on email alone.
