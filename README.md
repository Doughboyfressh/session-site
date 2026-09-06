# SESSION

A private early-access music collaboration network for artists, producers, and engineers.

## Included
- Profiles with unique usernames, creative roles, photos, and public/private visibility.
- Audio uploads in protected R2 storage with server-checked listening and collaboration permissions.
- Searchable beat/song library, saved tracks, follows, and track comments.
- Browser studio with 16 audio tracks, recording, a 16-step drum sequencer, offset and trim controls, gain, pan, 3-band EQ, private project saving, and stereo WAV export.
- Invite-only rooms (4 people), expiring/revocable invitations, room membership checks, text chat, direct WebRTC audio/video, and browser screen/audio sharing.
- Original synthesized starter loops and one original generated artwork asset.

## Scope and limits
This is an early working product, not a replacement for FL Studio, Logic Pro, or Pro Tools. It does not include third-party plug-ins, MIDI piano-roll editing, time stretching, automation, synchronized multi-user editing, royalty payments, licensed beat sales, or audio mastering analysis. Mixer changes apply at the next playback. Recording is limited to 2 minutes, imports/exports to 3 minutes, uploads to 25 MB, and per-user preview storage to 500 MB.

Rooms use direct peer-to-peer WebRTC and Google's public STUN service. A managed TURN relay/media service, network resilience work, and real multi-device browser testing are needed before broad use. Room invitations do not grant Sites platform access; this deployment starts owner-only.

Privacy and copyright text accurately describes this preview. Before public launch, establish operator identity, full Terms and Privacy Policy, account/media erasure and retention tools, a designated copyright contact/agent where applicable, notice/counter-notice handling, moderation, abuse/rate controls, and operational support. Stored reports do not currently trigger notifications or a staffed review queue. Uploaded media persists after listing deletion so existing arrangements are not broken. A listing becoming private does not revoke previously granted project access.

## Development
Use the included npm lockfile. Install with npm, run `npm run dev`, then run `npm run build` for the Cloudflare-compatible output. The development auth helper uses the Sites local sign-in flow. Production relies on dispatcher-supplied identity headers; do not expose the Worker directly without that trusted boundary. Database schema is in db/schema.ts; generated migrations are in drizzle/. Hosting binding names are in .openai/hosting.json.

## Validation
TypeScript checking and production build pass. An integration check against the local production Worker exercised signed-out mutations, private listing/media access, listen-only restrictions, permitted working copies, project ownership, member-only room/chat access, invitation rotation, removal revocation, and file signature validation. Camera/microphone and live multi-device sessions have not been exercised in a browser.
