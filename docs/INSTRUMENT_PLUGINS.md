# SESSION instrument plugins

In Studio, open an instrument track's Piano roll and use **Instrument plugins → Instrument engine**. Existing Studio voices and samples remain available. Changes preserve notes and enter undo history.

## Browser instruments

**SESSION Wavetable** is an original harmonic-morph synth with stereo unison, filter movement, envelope and drive. **SESSION FM** uses an original two-operator FM engine with ratio, depth, feedback and envelope controls. Both have three original presets, respond to the piano roll and MIDI recording, and save their settings with the project. Playback and WAV/stem export use the same engines. They contain no Xfer sounds or external recordings.

## Installed Windows VST3 instruments

1. Download the Windows x64 companion from [SESSION's release page](https://github.com/Doughboyfressh/session-site/releases/tag/session-companion-v0.1.0).
2. Extract the whole ZIP. Keep the bundled executable, Node runtime and notices together. Run `start-session-companion.cmd` and leave its console open.
3. Open SESSION at `https://session-site-eosin.vercel.app`, expand **Connect installed VST3 instruments**, and paste the fresh pairing code. If your browser requests local network access, allow it to connect to your companion.
4. Select an installed instrument. **Open VST3 editor** opens its real native window; close it to attach settings privately to the project. Save to retain those settings.
5. Edit notes, choose **Render for collaborators**, and save. Room members can then play/export the track without the plugin. Changed notes, tempo or plugin settings require a new render.

The code stays in browser memory. Signing out, changing accounts, disconnecting or restarting requires pairing again. The companion accepts only its configured SESSION origin and process token on loopback. Rendered audio and settings use authorized SESSION file routes; plugin state cannot become public through a track listing.

Serum 2 requires each musician's separately installed license, content and vendor authorization. This release was verified against Steinberg's official Note Expression Synth. **Actual licensed Serum 2 operation has not been verified.**

## Current bounds

- Native hosting supports Windows x64 float32 VST3 instruments with note input; VST2, AU and AAX are unsupported. Browser synths need no companion.
- Piano-roll playback and exports render native scores first. Use the native editor for live audition. Record physical MIDI with a browser instrument, then switch the track to VST3.
- The host supplies stereo, 4/4 transport and a 0.5-second tail. It has no MPE, native automation lanes or plugin latency compensation. Editor audio processes on the UI thread and can stutter under heavy interaction.
- Native scores allow 256 notes, 512 beats, 40–240 BPM and five minutes including the tail. Saved audio is limited to 25 MiB; long stereo scores may need shortening. State allows 8 MiB decoded. One native job runs at a time; scans have a 45-second total budget.
- The portable companion is an unsigned early-access Windows build. SESSION does not install/activate vendor instruments or bypass system warnings.

See [companion API/setup](../companion/README.md) and [native build/limitations](../companion/native/README.md).

## Verification

`npm test` checks actual arrangement validation, recovery, source conflicts, private upload/save/read authorization, cancellation across reconnects, and synthetic HTTP bridge behavior. `tests/browser-instruments-harness.html` runs numerical browser audio checks. `tests/plugin-studio-harness.html` exercises actual piano-roll/plugin controls and WAV exports with synthetic private-file/save fixtures. Native checks use the compiled SDK instrument: `node companion/native/test.mjs`. These fixtures do not prove every third-party plugin's compatibility.

Evidence, build logs and artifact hashes remain under ignored `outputs/instrument-evidence` and `outputs/companion`.

The October 2 acceptance run passed 43 offline suites, scoped lint, TypeScript, Sites and Vercel production builds, and a fresh independent review after its findings were fixed. Browser evidence includes 47 numerical synth checks, 19 integration checks, 8 actual editor-control checks, and 20 disconnected native-cache checks. It verifies private-file revocation, stale note/tempo/state rejection and distinct 44.1/48 kHz decoding. Desktop and 390-pixel viewport controls were exercised; real physical mobile devices remain outside this fixture evidence. The official SDK instrument passed 11 native scenarios, including editor attachment/state recall and exact fractional-tempo frame counts. The portable ZIP was extracted, its hashes rechecked, and its included runtime tested against the real host.

Production deployment `dpl_Hc4qjyvpjikFfUMyShoqzUyoAoK9` is READY at `https://session-site-eosin.vercel.app`, with source commit `eb0d2023f3fa05c096ddd0c15f213d57fc14edc5`. After rollout, 14 landing/workspace HTTP checks and 65 actual Neon Auth/PostgreSQL/private-storage checks passed, including private plugin-state upload, project save/reopen and unauthorized read rejection. Synthetic file, staging, database and auth-user cleanup was independently verified; provider-admin deletion removed only the two test auth users after their SESSION records and storage were empty. The deployed Studio's FM preset selection, note editing, playback meter and stereo WAV preparation were exercised with an unsaved guest fixture. Companion pairing, rendering and disconnected playback were verified in the local browser harness; production HTTPS pairing in the Codex in-app browser timed out and remains unverified. This does not establish production pairing or licensed Serum compatibility.
