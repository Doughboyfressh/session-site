# SESSION local VST3 companion

The Windows companion lets SESSION render notes through installed VST3 instruments and open their native editors. Plug-ins run on your computer. Install and license an instrument through its vendor; SESSION does not download instruments or bypass licensing.

Build the native host with `node scripts/build-companion.mjs`, then launch `companion/start-session-companion.cmd` with Node.js 22 or newer installed. The launcher finds the host in `outputs/companion/session-vst3-host.exe`; a distributable folder can instead contain `bridge.mjs`, `start-session-companion.cmd`, and `session-vst3-host.exe` together. Follow the native build requirements documented by the build script.

Keep the console open, copy its fresh pairing token into SESSION's local instrument controls, and rescan installed instruments. The token is generated for this running process and is never written to disk. Stopping or restarting the companion invalidates it. SESSION should retain the token only in browser memory. The default browser origin is `https://session-site-eosin.vercel.app`. For another deployment, launch with `--origin https://your-deployment.example`; local development accepts an exact loopback origin, for example `--origin http://localhost:3000`. Optional `--port 17341` changes the loopback port. Wildcards, URL paths, credentials, non-loopback HTTP, and multiple origins are rejected.

The companion scans only Steinberg's [standard Windows VST3 locations](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical%2BDocumentation/Locations%2BFormat/Plugin%2BLocations.html): `Program Files/Common Files/VST3`, `Program Files (x86)/Common Files/VST3`, and `%LOCALAPPDATA%/Programs/Common/VST3`. It skips symbolic links and bounds recursion, entries, modules, and instrument classes. Scans are cached until Rescan. Failed or incompatible modules count as warnings; the API never includes filesystem paths or native diagnostic output.

Opening an editor is an explicit action in SESSION. It opens the installed instrument's native window and returns its component/controller state when closed. Edits can be stored privately by SESSION and replayed for later renders. Only one scan, render, or editor can run at a time; close an open editor before rendering. A failed or disconnected browser request cancels its native job. Windows is the supported native platform; other systems report the native host unavailable. Plug-ins are local executable code and should come from sources you trust.

The bridge listens only on `127.0.0.1` (default port `17341`). Every API request needs the exact allowed `Origin` and `Authorization: Bearer <pairing-token>`. Browser CORS preflight is allowed only for that origin, the endpoint's method, and the `authorization`/`content-type` headers. It can acknowledge a browser private-network preflight for the same origin. No wildcard CORS, cookies, arbitrary paths, or browser-supplied executable arguments are accepted. Responses are private and uncached. Native requests, state, and WAV files live in isolated temporary job folders that are removed after completion, cancellation, or shutdown.

## HTTP contract

- `GET /v1/health`: `{version:1,platform,nativeAvailable,busy,paired:true}`.
- `GET /v1/plugins`: cached `{plugins:[{id,classId,name,vendor,version}],scannedAt,warnings}`. Both IDs are the lowercase 32-hex VST3 class ID.
- `POST /v1/rescan`, JSON `{}`: repeat discovery and return the instrument list.
- `POST /v1/render`: JSON `{pluginId,bpm,beats,sampleRate,notes,state?}` returns stereo PCM16 `audio/wav`. Notes are `{pitch,start,length,velocity}`, with MIDI pitch `0..127`, beat timing, and velocity `0..1`. Use `44100` or `48000` Hz, BPM `40..240`, at most `512` beats, `256` notes, and `300` seconds including a `0.5` second tail. Notes must end within the requested beat length.
- `POST /v1/editor`: JSON `{pluginId,bpm,state?}` opens the native editor and returns `{state:{component,controller}}` when closed.

State is `{component,controller}`, with canonical base64 strings (empty controller state is allowed) and at most `8 MiB` decoded across both fields. JSON requests are capped at `12 MiB`. Browser state file envelopes may include their own `version`, `format`, and `classId`, but those fields must be stripped before sending the `state` object to this API. Errors are `{error,code}`; authentication/origin failures are `401`/`403`, invalid input `400`, busy `409`, missing native host `503`, and native timeouts `504`. Scan commands time out after `10` seconds per module, renders after `120` seconds, and editors after `30` minutes. Socket disconnects and shutdown terminate the active native process tree.

Run `node tests/plugin-bridge-checks.mjs` for offline HTTP verification with synthetic native output. These checks never load installed plug-ins or print a real pairing token. Native hosting and an actual licensed instrument still require Windows integration testing.
