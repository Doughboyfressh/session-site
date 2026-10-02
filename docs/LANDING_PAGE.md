# SESSION landing page

The public homepage at `/` introduces SESSION Originals, the browser studio, and private collaboration rooms. The page renders on the server without initializing the studio audio engine, camera, microphone, or community API polling. Beat and genre counts and featured track metadata come from the real catalog. Featured artwork links to existing public track pages, and the primary actions open the actual studio and library.

`/app` is the workspace entry for guests and signed-in members. It uses the existing server identity wrapper and preserves the per-account component key. Installed-app startup now opens `/app`. Draft recovery and onboarding storage names remain unchanged.

Legacy root URLs containing nonempty `view`, `room`, `project`, `track`, `stripe`, or `order` parameters still render the workspace in place. This preserves old invitation fragments, shared tracks/projects, and payment returns. Workspace navigation and new track/room links use `/app`. Workspace sign-in links materialize the current query and fragment after hydration so normal clicks, middle clicks, and copied links retain context, with `/app` as the server fallback destination; provider redirects still use the existing return-path validation.

The landing page is responsive, uses semantic links and native FAQ disclosures, includes a skip link and visible keyboard focus, and respects reduced-motion preferences. It introduces existing features without fabricated activity, testimonials, pricing, or new license claims. Its studio and room diagrams are illustrations.

Verification: `tests/workspace-entry-checks.mjs` covers guest marketing traffic, supported legacy links, and sign-in destinations containing room invitation fragments and track/payment state. Run the normal release checks and both production builds. Browser acceptance must cover desktop and mobile layout, FAQ keyboard interaction, studio/library/room actions, featured-track playback, legacy root entry, and navigation back to the workspace feed. Keep generated screenshots and HTTP evidence under ignored `outputs/landing-evidence`.

Run read-only Vercel/Neon HTTP acceptance with `SESSION_VERIFY_BASE` set to the running Vercel/Neon origin and `node tests/landing-http-checks.mjs`. This checks server-rendered landing content, all three featured beats' editable arrangements, canonical and legacy workspace entries, the Neon sign-in redirect's fragment preservation, and installed-app startup. It does not create accounts or write production data. Sites uses its dispatcher sign-in flow; its offline suites and production build are checked separately.

## Release acceptance — October 1, 2026

- Source: `b11e2773350fa0fd130dbbc410f3cb4b0527eca6`; Vercel deployment: `dpl_GqCyawTofjjdw3xrBF27GvnhDWXy`, READY, production.
- Live alias: https://session-site-eosin.vercel.app/ ; immutable artifact: https://session-site-pbu0zcghc-doughboyfressh.vercel.app/ .
- All 29 offline suites, TypeScript, scoped lint, and Sites plus Vercel production builds passed for that source. Independent review found no remaining high/medium findings after corrections.
- Read-only HTTP acceptance passed all 14 checks on local Next and the live Vercel origin. No production fixtures or accounts were created.
- Actual browser acceptance passed desktop and 390/320 px mobile homepage layout without horizontal overflow, keyboard FAQ disclosure, landing-to-Studio/library/rooms actions, featured-track preview playback and editable-arrangement links, and hydrated sign-in context. Direct Studio entry also passed React StrictMode testing locally.
- Recorded evidence is under ignored `outputs/landing-evidence`: `validation-final`, production HTTP JSON, deployment log, and desktop/mobile/Studio/featured-preview screenshots. The mechanical pipeline's CLI e2e stage was skipped; browser acceptance was performed separately through the real browser. Mobile checks used viewport simulation, not physical-device certification.

This release does not change the operational limitations and remaining full-product acceptance in `PRODUCTION_READINESS.md`.
