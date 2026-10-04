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
