import { spawnSync } from 'node:child_process';

// Offline release checks. Browser/HTTP acceptance and dependency audits are
// recorded separately in docs/PRODUCTION_READINESS.md.
const checks = [
  ['typecheck', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ['tests', 'scripts/test.mjs'],
  [
    'hardening-module lint',
    'node_modules/oxlint/bin/oxlint',
    'lib/audio-processing.ts',
    'lib/audio-processing-worker.ts',
    'lib/orders.ts',
    'lib/stripe-server.ts',
    'app/api/stripe/route.ts',
    'app/api/stripe/webhook/route.ts',
    'app/api/search/route.ts',
    'app/track-permalink.tsx',
    'lib/timestretch.ts',
    'lib/audio-latency.ts',
    'lib/automation.ts',
    'lib/playlist-clips.ts',
    'lib/upload-body.ts',
    'lib/instruments.ts',
    'lib/originals.ts',
    'lib/audio-cache.ts',
    'lib/arrangement-tempo.ts',
    'lib/room-invites.ts',
    'lib/workspace-entry.ts',
    'lib/studio-ui.ts',
    'lib/room-media-controls.ts',
    'tests/ui-defects-harness.tsx',
    'app/landing-page.tsx',
    'app/workspace-page.tsx',
    'app/workspace-sign-in-link.tsx',
    'app/page.tsx',
    'app/app/page.tsx',
    'app/room-invitations.tsx',
    'app/social.tsx',
    'tests/room-invitations-harness.tsx',
    'tests/originals-harness.tsx',
    'lib/presets.ts',
    'lib/pump.ts',
    'lib/pitch.ts',
    'lib/mastering.ts',
    'app/channel-fx.tsx',
    'app/automation-editor.tsx',
    'app/arrangement-timeline.tsx',
    'scripts/test.mjs',
    'scripts/check.mjs',
  ],
  ['production build', 'node_modules/vinext/dist/cli.js', 'build'],
];
for (const [name, ...args] of checks) {
  console.log(`Checking ${name}`);
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    timeout: 300000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
