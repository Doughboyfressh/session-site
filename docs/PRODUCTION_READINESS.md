# SESSION release readiness

Updated September 30, 2026. This is a development release assessment, not a production certification or a legal compliance opinion.

## Status

SESSION is still an early-access service. The changes below are suitable for a controlled release after the recorded checks pass. A general public launch remains blocked by the final device/network review, operational setup, account-deletion/moderation workflow, and operative legal policies. Keep the current Sites audience unchanged; an invitation to a room is not a grant of site access.

## Changes since September 28 (this release)

- **Payments (Stripe).** Profiles can list up to three priced services and tracks can carry a buy price. Buyers pay through Stripe Checkout with destination charges to the seller's connected Express account; `STRIPE_FEE_BPS` optionally takes a platform fee. A signature-verified webhook (`/api/stripe/webhook`) marks orders paid idempotently, notifies both members, and opens an accepted message thread for delivery. Orders, sales and purchases appear on the profile. Without `STRIPE_SECRET_KEY` the whole surface runs in a "payments coming soon" mode: prices list, checkout actions explain and disable. Migration 0009 adds `profiles.rates`, `tracks.price`, `stripe_accounts`, `orders`, and `stripe_events`. Money flows seller-ward immediately; SESSION provides no escrow, and the Terms draft states this.
- **Community growth loop.** Migration 0010 adds `tracks.plays` and `rooms.visibility`. Previews count plays once per viewer per session (public tracks only); the feed shows play and comment counts, a Trending worldwide rail, a global pulse strip, and Live-now public rooms. Rooms can be created invite-only or discoverable; public join is capacity-checked (4) server-side. Sharing produces real deep links: `/t/<id>` permalink pages (public tracks only, guest playback, OG meta) and `?track=` in-app deep links. Search moved server-side (`/api/search`) with per-account (240/min) and per-IP guest (60/min) budgets.
- **Fourth role: Videographer.** Joins Artist/Producer/Engineer in profile roles, the people directory, collaboration-request roles (client- and server-validated), paid service listings, feed role cards, and legal copy.
- **Recording and live media quality.** Room takes now open a second, studio-grade mic path with echo cancellation, noise suppression, and AGC disabled (falls back to the processed call mic when unavailable; lease dies with the call). The recorder gains a device picker in room mode, latency-safe headphone monitoring with a level control, peak-hold metering with numeric peak, and a measured-latency "Measure" button filling the delay-correction field. Rooms support live mic/camera switching and a 360p/720p quality choice applied via `replaceTrack` without reconnecting. Shared studio audio is sent at music-grade Opus (256 kbps).
- **Onboarding and checklist.** A five-step first-run tour (remembered per device, replayable from the profile checklist) with deep links into the studio and rooms; the profile checklist tracks photo, bio, first track, follows, rooms, and payouts.
- **Redesign.** The interface is now black and white with deep crimson accents (`#d11a33`): monochrome surfaces, red reserved for primary actions, active states, price chips, and recording/danger semantics. Cover art is deterministic generated vinyl (white/silver/black discs with red pops). A live WebGL equalizer hero (three.js, code-split, poster fallback, reduced-motion aware) and an audio-reactive spectrum visualizer in the studio rail.
- **Release tooling.** The scoped hardening lint now covers the payments, recording, and media modules (clean). The check pipeline is typecheck, 24 suites (was 21), scoped lint, and the production build.

Payments acceptance remains blocked on operator setup: Stripe account, test-then-live keys, and the webhook endpoint registered against the deployed URL. Email digests remain unbuilt pending an email provider decision.

## Changes in the September 28 release

- Mixer channels now support reusable named clip placements without duplicating channel strips. Each placement has its own offset, trims, fades, and name; split, duplicate, repeat, move, rename, and removal are reversible. Playback, loops, mixdown, stems, recovery, validation, source-note edits, and collaboration use the same bounded model. Limits are 32 clips per channel and 256 per project. Existing top-level track geometry remains the primary clip for backward compatibility; mix, effects, routing, and automation remain channel-wide.
- Seven bounded automation lanes per track now cover volume, pan, low/mid/high EQ, reverb, and delay with Linear/Hold transitions, beat snapping, direct manipulation, precision editing, lane copy/paste, one-step gesture history, and a moving playhead. Playback, loops, processed mix/stem export, recovery, and collaboration use the same lane model. Older volume-only clients remain compatible; ambiguous hybrid saves use the legacy field as the newer old-client edit and current recovery migrates it to the explicit lane.
- Save and browser recovery preserve all channel, vocal and time/pitch controls and all seven instrument choices. Presets always supply required EQ defaults, validate imported/local values, report storage failures and distinguish user presets from built-ins.
- Delayed remix/project-open responses cannot replace a workspace after navigation or newer edits. Project lists retrieve summaries; full arrangements load only when opened.
- Uploads enforce a 26 MiB total multipart-body limit even without a truthful Content-Length, plus 25 MiB audio/3 MiB photo limits, the existing atomic account quota, and 30 upload requests per account per minute.
- Authorized audio delivery supports byte ranges and HEAD for seeking. Authorization runs before revealing file size/content. Success, denial and failure responses are private/no-store. Public listings do not expose a private creator profile's name.
- Audio processing runs in a worker, with one active job, cancellation and a two-minute processing timeout. Source audio is limited before processing; active playback buffers have a combined memory bound. Playback rechecks access to cached uploaded audio.
- Stretch/pitch uses shared-channel waveform similarity alignment and filtered resampling. Clip metadata represents the processed duration exactly once. Changes invalidate waveforms and duration. Pump timing follows the project playhead and loop position. Disabled limiters bypass lookahead; enabled limiter and mastering exports compensate measured delay.
- AutoPitch is unavailable: its initial implementation failed numerical pitch tests. Projects retain this setting and can save/recover it. A visible action turns it off; playback/processed export explains the requirement instead of silently producing incorrect correction. Dry export bypasses vocal effects while preserving structural time/pitch edits.
- The existing unpublished 48-track limit, seven instrument voices, remix lineage migration, insert effects and export mastering are included with the fixes. Channel processing controls are locked during playback/recording/export.

Mastering presets are creative processing with a sample-peak ceiling. They do not provide certified LUFS normalization, true-peak compliance, formant preservation, or professional DAW equivalence. Stretching complex/transient material still needs listening review. Project limits do not promise that every device can play 48 long tracks.

## Reproducible checks

Use the committed lockfile and Node >=22.13. `npm run typecheck`, `npm test`, and `npm run build` provide the release checks. `npm test` writes individual logs and a JSON summary to `outputs/release-checks` and returns failure if any suite fails. The runner currently has 32 suites, including the reusable-playlist model, landing/workspace entry, Studio UI, room device-switch controls, and scene geometry/framing. `tests/production-checks.mjs` verifies presets/recovery, supported instruments, processed clip geometry, pitch/duration/stereo numerical checks, dry-source rules and pump alignment. `tests/backend-checks.mjs` executes actual API handlers with real migrations in isolated SQLite and simulated R2, including malformed multipart limits, throttling, range requests and denied private access.

`npm run check:release` runs those checks plus lint on the new hardening modules. This is explicitly a scoped lint check: the repository-wide lint baseline still contains pre-existing findings and has not been certified clean.

Browser fixtures under `tests/*-harness.html` use actual UI/audio code and synthetic local data. They do not prove real iPhone compatibility, physical recording latency or cross-network TURN delivery. Check production, export, sampler, recovery (including interrupted/rapid writes), MIDI and loop recording after changing audio or dependencies. The release evidence records each fixture actually run; do not infer unrun fixtures passed.

Dependency advisories are checked against npm. React, Vite, image-size, undici and Cloudflare tools have been updated for the advisories found during this review. Preserve evidence for the full and production-only audits; a zero production audit is not a guarantee that the software has no vulnerabilities. Never use `npm audit fix --force` indiscriminately.

The September 21 audit found zero production dependency advisories and four moderate development-only findings in the Drizzle migration tooling's legacy esbuild dependency chain. The full audit has no high or critical findings. Do not expose that tooling's development server. Resolve the remaining advisories through a supported migration-tool update, without downgrading the schema tooling merely to satisfy the audit. The build also warns about a large client bundle; performance on representative mobile hardware remains part of acceptance.

## Required final acceptance

1. Repeat the complete artist/producer/engineer journeys on the released version: profile/photo/privacy, upload/listen/collaborate, remix, record, edit, save/reopen/recovery, export, shared rooms and revoked permissions. Test real production identity boundaries with two separate accounts. Test a logged-out request and a nonmember before any private file is fetched.
2. Repeat iPhone Safari and desktop calling on separate networks, explicitly force TURN, and record the selected relay route. Verify both-way voice/video/shared music, mute, reconnection, a network switch, background/foreground, screen lock and capture shutdown. Run at least a 60-minute session and a four-person session. Record device/browser versions, timestamps and measured failures. Earlier user-observed passes are provisional.
3. Test large but supported projects on representative desktop and mobile hardware. Measure preparation time, memory pressure, audio underruns, save latency and cancellation. Load-test only a dedicated test environment with synthetic accounts; do not stress the live site without an agreed window and request budget.
4. Supply the operator, jurisdiction, territory/age policy and monitored support/privacy/copyright contacts, then reconcile and activate the legal drafts with appropriate legal review. Do not add a fictional operator, effective date, registered copyright agent or claim binding draft acceptance. The user deferred these details until development is complete.
5. Complete and test a verified account-deletion process, report review/moderation, copyright case handling and retention enforcement. File erasure is not account deletion. Stored reports have no staffed response or outbound alert by themselves.
6. Complete the operational procedures below, assign named owners and demonstrate restoration. Do not declare readiness merely because a build deploys.

## Operations and recovery runbook

### Release and rollback

Record the exact Git SHA, saved Sites version and deployment ID. Build from that SHA, scan source/build output for credentials, retain the immutable artifact and deploy only a saved version. Preserve the existing access audience and server-only TURN secrets. Migration 0005 only adds nullable `projects.forkedFrom`; do not edit earlier migrations. Confirm the migration applied before testing remix creation. If a release fails, redeploy the prior saved version and check its status. A code rollback does not reverse database writes; choose a forward fix or a separately reviewed restoration when data is affected.

### Backups and restore drill

Inventory the actual Sites-managed D1 and R2 bindings and identify who can restore each. Cloudflare documents D1 Time Travel, but this review has not verified operator access to restore controls through Sites. See [Cloudflare D1 recovery documentation](https://developers.cloudflare.com/d1/reference/time-travel/). Database restoration alone cannot restore erased audio objects. Establish independent, access-controlled recovery for media plus metadata and provider configuration, choose recovery-time/data-loss targets, and perform a synthetic restore drill in an isolated environment. Verify byte hashes, project links, private access and deletion/retention records after restoration. Never restore deleted members' public access automatically.

### Monitoring and incident handling

Assign an accountable responder and a monitored destination before enabling notifications. Track failed uploads/saves, API 5xx, D1/R2 capacity, TURN issuance/relay failures and room reconnection failures without logging audio, credentials or full private payloads. Set alert thresholds from measured normal traffic and test one alert delivery. No monitoring automation has been enabled by this change.

For an incident: record time/version/request identifiers; contain the affected feature; preserve the minimum relevant evidence; roll back code if indicated; verify recovery with a synthetic account; assess whether affected members or regulators must be notified under the final operating policy. Rotate an exposed TURN secret through the hosting environment and verify newly issued short-lived credentials. Never put secrets in chat, source, browser code or diagnostic exports.

### Privacy and copyright work

Assign reviewers for access/correction/erasure requests and abuse/copyright reports. Verify identity and scope before acting; preserve legally required holds and minimal decision records. Check files, listings, project links, saved versions, take banks and provider backups separately. Define retention periods and a tested enforcement job; opportunistic room-event cleanup is not a guaranteed deletion schedule. Publish only contact channels that are staffed. Final legal notices remain drafts until the operator supplies the deferred facts and approves activation.
