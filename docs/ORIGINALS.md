# SESSION Originals, composition version 1

The library contains the ten unchanged starter loops plus 48 new synthesized compositions: two each in 24 genre families. The immutable `demo-original-v1-*` identifiers support catalog sharing and Studio deep links. Every new score declares its BPM, key, chord progression, melody, rhythmic vocabulary, instrument voices and drum kit in `lib/originals.ts`. No recordings, music generation service, paid API or database migration are used.

Previews use eight bars of the same layer sources as the full arrangement. Full scores target approximately two minutes, rounded to four-bar sections, with introductions, verses, hooks, turnarounds, a breakdown and an outro. Each has separate groove, fill, bass, harmony, theme and answer channels; named playlist clips describe the structure. The synth guitar, strings and brass are synthesized approximations, rather than recordings of acoustic instruments.

Studio opens native notes and drum patterns. New melodic layers declare `noteLoopBeats: 16`, which keeps each four-bar source stable when notes are edited or removed. Notes must stay inside that loop. The half-second render tail is excluded from each playlist placement; this tail exclusion permits note timing edits, while manually trimmed or split instruments retain their existing protection. Notes, sounds, patterns, loop lengths and placements persist in ordinary project JSON and draft recovery. Opening another copy creates fresh channel and clip identities.

Changing tempo follows generated clip positions, trims, fades and automation in beat time. Recorded audio retains its existing positions. Generated durations are derived from the score before enrichment; changes or appends exceeding the five-minute project limit are rejected. Existing saved projects require no migration.

Audio renders on demand. A 64 MiB LRU cache holds rendered sources; oversized individual sources can play without being retained in the cache. Cancelled preview work does not start playback or populate the cache after cancellation. No full rendered library is kept in memory or downloaded at startup.

## Verification and audition

`npm test` includes `tests/originals-checks.mjs`: catalog counts, two scores per family, unique patterns, note keys, project and note limits, source identity between previews and arrangements, editing operations, tempo round trips, recovery and bounded cache eviction. `npm run check:release` runs typechecking, regression suites, scoped lint and the Sites build; `npm run build:vercel` builds the separate Vercel target.

For browser audio auditing and listening review:

```sh
node node_modules/vite/bin/vite.js --config tests/vite.harness.config.mjs
```

Open `http://127.0.0.1:4173/tests/originals-harness.html`. Each genre has two audition buttons and Stop audio. **Audit all 48** sequentially renders each preview and arrangement at 44.1 kHz, rejects non-finite samples, clipping, silence and duplicate previews, encodes and decodes every WAV, and renders timing edits and tempo changes for one composition per family. The visible JSON records peak, RMS, silence, duration, hash, WAV size and cache usage. Export includes the existing 1.8-second effects tail, which is excluded from tempo-alignment comparisons.

`tests/originals-ui-harness.html` adds the actual SESSION browsing and Studio components with an isolated frontend save fixture. Use it for responsive browsing, preview switching and Studio controls. The fixture is separate from real backend persistence: `tests/deployment-http-checks.mjs` additionally saves an edited Amapiano score and reopens it through authenticated Neon/PostgreSQL routes, checks ownership and public original permalinks, and cleans its disposable fixtures.

Numeric audio audits do not substitute for human musical review. Use the audition controls to judge the compositions' sound and genre fit. Browser viewport checks do not establish physical-device compatibility.
