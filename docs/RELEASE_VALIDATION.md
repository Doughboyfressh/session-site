# September 21, 2026 release validation

This records observed development checks for the studio hardening release. See [production readiness](PRODUCTION_READINESS.md) for unresolved launch requirements. Synthetic browser media and local data do not establish physical-device or production-network reliability.

## Automated and server checks

- The release runner executes 19 suites, including 207 production-hardening assertions and 36 in-process backend checks. Per-suite logs and timestamps are written to `outputs/release-checks`.
- The built Worker was exercised with isolated local D1/R2 state: 171 API, 16 clip, 62 creation and 248 collaboration assertions passed (497 total). Collaboration used 140 local requests. Synthetic fixtures were cleaned up by the suites; production accounts and music were not used.
- Type checking and the production build passed. The new hardening modules pass scoped lint; repository-wide lint still has earlier findings.
- npm audit: zero production dependency advisories; four moderate development-only findings, no high or critical findings. Details and the limitation are in the readiness document.
- A scan of tracked/unignored source and generated assets found no matches for configured TURN credentials. Credential values are not included in logs or reports.

## Observed browser checks

The built browser fixtures were exercised in the desktop browser with actual Web Audio rendering and generated sources. Console error checks were empty for the tested pages.

| Fixture | Observed result |
| --- | --- |
| Production hardening | 18 assertions: export/limiter alignment at 44.1 and 48 kHz, finite audio, responsive worker processing, active/queued cancellation, dry export, revoked cached sources and mastering duration |
| Export | 68 assertions: rendering, timing, fades/effects, deterministic drums, package content, cancellation/retry |
| Sample instrument | 28 assertions: real Studio controls, source access/cancellation, Undo, recovery, pitch cache, envelope, render/export and MIDI monitor |
| Recovery | 62 core assertions; 15 interruption/account/save-order assertions; rapid 40-edit recovery and later-edit preservation after save acknowledgement also passed |
| MIDI engine | 21 assertions: lifecycle, timing, rendering, sustain, full note range, permissions, hot-plug and stale callbacks |
| MIDI Studio | 15 assertions: permission, review, Keep, Undo/Redo, full-range editing, unplug, revoked access and discard |
| Loop engine | 46 assertions: audio clock, PCM, pre-roll, correction, stopping and interruption |
| Loop interface | 11 assertions: controls, separate originals, busy locks, punch coverage and comp choices |
| Room audio | 35 assertions: recording input leases, voice/music isolation, screen sharing, ICE restart, late join, offer collision and capture cleanup. The observed RTC route was local host, not TURN. |

The built app loaded, opened Studio, selected the Glass bell instrument and accepted a note. At a 390 × 844 viewport, Studio controls fit the screen and document scroll width matched client width (375 px excluding the scrollbar). This is a desktop viewport check, not an iPhone Safari pass.

## Independent review

Read-only backend and audio reviews found and then rechecked fixes for delayed remix responses overwriting edits, legacy preset-name collisions and delayed queued-worker cancellation. The final bounded rechecks reported no remaining medium/high findings in those fixes. That finding is limited to reviewed changes, not a certification of the entire service.

The mechanical release pipeline records its final verdict, exact commit and logs under `outputs/release-checks/pipeline`. The published version and deployment result belong in the retained release record after publication. Do not treat this document as evidence that unperformed device, load, restore or legal acceptance checks passed.
