# SESSION

A private development release for artists, producers, and engineers.

## Studio

- 32-track arrangements; uploaded audio, starter loops, a 16-step drum sequencer, and piano-roll instruments (keys, bass, pad).
- Note pitch, timing, length, velocity, quantization, and MIDI export.
- Live volume, mute/solo, pan, three-band EQ, compression, reverb, delay, and master peak meter.
- Clip offset/trim, fades, volume automation, loops, metronome, start position, duplication, and undo/redo.
- Private saves with revision conflicts, optional ten-second autosave, and up to 20 manual checkpoints. Previously authorized source files remain attached to project history until project deletion or explicit file erasure.
- Microphone recording up to two minutes; imports and stereo 44.1 kHz / 16-bit WAV export up to five minutes. Uploads: 25 MB per file, 500 MB per account.

This browser studio does not yet match FL Studio, Logic Pro, or Pro Tools. Native VST/AU/AAX hosting, advanced time stretching and pitch correction, take comping, MIDI device input, bus routing, stem packages, mastering loudness analysis, and sample-accurate recording compensation are not implemented. Generated sources follow tempo; imported audio retains its original speed. Structural edits and automation apply on the next playback. Keep independent backups.

## Community and rooms

Profiles, usernames, avatars, roles, public/private visibility, protected uploads, saved tracks, follows, and comments are supported. Public listen-only access is distinct from open-collaboration access to private working versions. SESSION does not sell licenses, clear samples, distribute music, collect royalties, or accept payments.

Four-member invite-only rooms include expiring/revocable invitations, host removal, chat, camera/mic participation, and separately chosen screen/tab-audio sharing. Membership and active media sessions are separate. A new call from one account replaces its old session. Signals carry both session identities; retries are deduplicated and stale signals rejected. Perfect negotiation, bounded ICE recovery, and manual renegotiation support reconnecting. Route, round-trip time, jitter, and loss are displayed.

Cloudflare STUN is configured. Optional TURN credentials are issued server-side only to authorized room members. Add CLOUDFLARE_TURN_KEY_ID and secret CLOUDFLARE_TURN_API_TOKEN through Sites runtime settings; never place the token in browser code. No relay credentials are currently configured. Rooms disclose availability. See [Cloudflare credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

Sites access remains owner-private; room invitations alone do not grant site access. Rooms support one person driving and others listening, not synchronized remote ensemble performance or concurrent DAW editing. No server room-media recording is implemented; participants may capture received media.

## Policies and privacy

Rights & privacy contains full, nonoperative drafts of Terms, Privacy Notice, Copyright notices/counter-notices and repeat infringement, and Collaboration Permissions and Credits. The user will provide operator, territory, contact, and jurisdiction details after development. Draft acceptance is not collected. The proposed adult/US scope is not an active age or territory gate.

Authenticated account JSON export, file listing/download, and explicit permanent file erasure are available. Erasure removes the hosted original and project access links; it cannot recall downloaded/cached copies. Listing deletion is separate. Account deletion and staffed legal/privacy operations remain unfinished. Reports are stored without external notifications. Room events are hidden after 24 hours and pruned on later message activity; closing a room deletes them. This is not a scheduled retention guarantee.

## Development and validation

Use the committed lockfile. npm run dev runs the local preview; npm run build creates the Worker output. Production identity relies on trusted Sites dispatcher headers. Do not expose the Worker outside that boundary. D1 migrations are append-only; 0000 is preserved and 0001 adds media sessions, revisions/history, rate limits, and signal deduplication.

Connection check runs the real studio renderer and PeerLink class with generated media. It tests exports and automation, two local peers, received audio before silent speaker output, decoded video, mute/unmute, ICE restart, a second stream, and durable disconnect. It does not access hardware or send media to another person.

The local production API suite has 102 assertions covering privacy, revision conflicts, version ownership, invitations/member access, media-session replacement, duplicate/stale signals, export isolation, erasure authorization/revocation, and upload validation. The unrelated-Origin check exercises Wrangler's local rejection rather than production dispatcher's CSRF behavior. Cross-device, cross-network/TURN, real capture, browser compatibility, sustained load, and long-session tests remain separate release requirements.
