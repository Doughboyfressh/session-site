# SESSION instrument plugins

In Studio, open an instrument track's Piano roll and use **Instrument plugins → Instrument engine**. Existing Studio voices and samples remain available. Changes preserve notes and enter undo history.

## Browser instruments

**SESSION Wavetable** is an original harmonic-morph synth with stereo unison, filter movement, envelope and drive. **SESSION FM** uses an original two-operator FM engine with ratio, depth, feedback and envelope controls. Both have three original presets, respond to the piano roll and MIDI recording, and save their settings with the project. Playback and WAV/stem export use the same engines. They contain no Xfer sounds or external recordings.

## Installed Windows VST3 instruments

1. Download the Windows x64 companion from [SESSION's release page](https://github.com/Doughboyfressh/session-site/releases/tag/session-companion-v0.1.1).
2. Extract the whole ZIP. Keep the bundled executable, Node runtime and notices together. Run `start-session-companion.cmd` and leave its console open.
3. Open SESSION at `https://session-site-eosin.vercel.app`, expand **Connect installed VST3 instruments**, and paste the fresh pairing code. If your browser requests local network access, allow it to connect to your companion.
4. Select an installed instrument. **Open VST3 editor** opens its real native window; close it to attach settings privately to the project. Save to retain those settings.
5. Edit notes, choose **Render for collaborators**, and save. Room members can then play/export the track without the plugin. Changed notes, tempo or plugin settings require a new render.

The code stays in browser memory. Signing out, changing accounts, disconnecting or restarting requires pairing again. The companion accepts only its configured SESSION origin and process token on loopback. Rendered audio and settings use authorized SESSION file routes; plugin state cannot become public through a track listing.

Pairing shows **Checking companion connection**, then **Scanning installed instruments**. The health request has a 15-second deadline; discovery retains 60 seconds for the host's 45-second scan budget. Deadline errors explain how to retry; intentional cancellation remains separate. Uppercase hexadecimal codes are normalized before authentication. Empty scans and skipped/unreadable entries remain visible even when the connection panel collapses; a successful rescan replaces the previous warning state.

SESSION and the companion must run on the same Windows computer. Public sites may need a browser's local-network permission ([Chrome guidance](https://developer.chrome.com/blog/local-network-access)). If an embedded browser blocks the connection, use a regular browser on that computer and allow its local-network prompt. Browser protections are not disabled by SESSION.

Serum 2 requires each musician's separately installed license, content and vendor authorization. This release was verified against Steinberg's official Note Expression Synth. **Actual licensed Serum 2 operation has not been verified.**

## Current bounds

- Native hosting supports Windows x64 float32 VST3 instruments with note input; VST2, AU and AAX are unsupported. Browser synths need no companion.
- Piano-roll playback and exports render native scores first. Use the native editor for live audition. Record physical MIDI with a browser instrument, then switch the track to VST3.
- The host supplies stereo, 4/4 transport and a 0.5-second tail. It has no MPE, native automation lanes or plugin latency compensation. Editor audio processes on the UI thread and can stutter under heavy interaction.
- Full component reload callbacks are unsupported. Editors relying on host-forwarded keyboard/focus interface callbacks may have limited keyboard interaction.
- Native scores allow 256 notes, 512 beats, 40–240 BPM and five minutes including the tail. Saved audio is limited to 25 MiB; long stereo scores may need shortening. State allows 8 MiB decoded. One native job runs at a time; scans have a 45-second total budget.
- The portable companion is an unsigned early-access Windows build. SESSION does not install/activate vendor instruments or bypass system warnings.

See [companion API/setup](../companion/README.md) and [native build/limitations](../companion/native/README.md).

## Verification

`npm test` checks actual arrangement validation, recovery, source conflicts, private upload/save/read authorization, cancellation across reconnects, and synthetic HTTP bridge behavior. `tests/browser-instruments-harness.html` runs numerical browser audio checks. `tests/plugin-studio-harness.html` exercises actual piano-roll/plugin controls and WAV exports with synthetic private-file/save fixtures. Native checks use the compiled SDK instrument: `node companion/native/test.mjs`. These fixtures do not prove every third-party plugin's compatibility.

Evidence, build logs and artifact hashes remain under ignored `outputs/instrument-evidence` and `outputs/companion`.

The October 2 acceptance run passed 43 offline suites, scoped lint, TypeScript, Sites and Vercel production builds, and a fresh independent review after its findings were fixed. Browser evidence includes 47 numerical synth checks, 19 integration checks, 8 actual editor-control checks, and 20 disconnected native-cache checks. It verifies private-file revocation, stale note/tempo/state rejection and distinct 44.1/48 kHz decoding. Desktop and 390-pixel viewport controls were exercised; real physical mobile devices remain outside this fixture evidence. The official SDK instrument passed 11 native scenarios, including editor attachment/state recall and exact fractional-tempo frame counts. The portable ZIP was extracted, its hashes rechecked, and its included runtime tested against the real host.

Production deployment `dpl_Hc4qjyvpjikFfUMyShoqzUyoAoK9` is READY at `https://session-site-eosin.vercel.app`, with source commit `eb0d2023f3fa05c096ddd0c15f213d57fc14edc5`. After rollout, 14 landing/workspace HTTP checks and 65 actual Neon Auth/PostgreSQL/private-storage checks passed, including private plugin-state upload, project save/reopen and unauthorized read rejection. Synthetic file, staging, database and auth-user cleanup was independently verified; provider-admin deletion removed only the two test auth users after their SESSION records and storage were empty. The deployed Studio's FM preset selection, note editing, playback meter and stereo WAV preparation were exercised with an unsaved guest fixture. Companion pairing, rendering and disconnected playback were verified in the local browser harness; production HTTPS pairing in the Codex in-app browser timed out and remains unverified. This does not establish production pairing or licensed Serum compatibility.

The October 2 connection follow-up passed 35 client cancellation, stage, timeout, token and scan-report checks. The actual client authenticated an uppercase code and rendered the SDK synth through the real bridge using Node HTTP with the production Origin; that is not a browser pairing result. The local browser verified uppercase pairing, visible empty-scan/warning guidance with the disclosure collapsed, warning removal after rescan, and disconnect. At a 390-pixel viewport the plugin panel's client/scroll widths were both 325 pixels; the piano-roll grid retains its horizontal scroll. A fresh independent review found no medium/high defect. Codex Browser Use reported `ERR_BLOCKED_BY_CLIENT` when opening the loopback health address directly. Production browser pairing and licensed Serum acceptance remain unverified.

The follow-up is deployed as READY production deployment `dpl_77XpcJo983XgV6RsUceo1xZXHwPC`, source `fb2b6bfb667f77d8408e8f6f10ac768d12a6dc0d`, at the same production alias. The mechanical pipeline passed all 43 offline suites, TypeScript, scoped lint and both production builds; 14 live landing/workspace HTTP checks passed after rollout. Live Studio displays the new checking stage and timeout recovery guidance. Pairing still did not complete in the in-app browser; this rollout does not establish ordinary-browser or licensed Serum compatibility. The portable companion binary remains the unchanged v0.1.0 prerelease.

The v0.1.1 native follow-up fixes processing setup before bus activation, explicit activation failures, unsupported full-reload acknowledgement, and constrained editor resizing. The previous host rendered silence with a strict lifecycle instrument and accepted an unsupported reload. Acceptance now includes 14 strict instrument/callback scenarios plus the 11 official SDK scenarios. Fresh review identified SDK synchronous acknowledgement, one-pixel zoom rounding, restore, and unchanged-zoom resizing cases; their fixes and regressions passed, with no remaining medium/high review finding. Test binaries and plugins are excluded from the ZIP. The full web pipeline passed 43 offline suites, TypeScript, lint and both production builds at `7956ca8`; subsequent corrective changes affect native C++ and documentation only.

Chrome was tested against the production alias with an ephemeral SDK companion. Pairing timed out both before and after the user reported allowing SESSION local-network access; its isolated request trace remained empty. The cause is unresolved. The unsaved test instrument was undone, the temporary tab closed, and the companion stopped. Production browser pairing and licensed Serum operation remain unverified.
