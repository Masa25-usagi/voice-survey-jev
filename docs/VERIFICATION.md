# Verification record

## Separate feature version — 2026-10-10

- Public MIT baseline: `8cb97b984225da2210ce325552e9c53f2d2c5ba6`. The original checkout remains clean at this commit; the new checkout uses `experimental/jev-features`, a separate package name and loopback port 4387.
- `npm test`: 137 passing tests, zero failures/skips, including the existing 98 core tests. TypeScript compilation passes.
- New tests cover score-only requests, exact rubric/expectation/distribution validation, pinned-model drift, schema identities, immutable proposals, LLM training-only input, signed learned weights, regularization, validation selection independent of test values/labels, low-margin abstention, duplicate/group/class-support rejection, evidence masks, all four survey types, skipped/declined/no-answer states, live-handler mock contracts and late-cancellation/manual protection.
- CLI train/evaluate was exercised with the original fictional feature cache. The final evaluation is a separate operation and does not update the model. No API key or paid service was used.
- Browser Harness operated the new demo in Chrome at 390 × 844 CSS pixels, using target-scoped focus emulation so an inactive full-screen browser could process input. Coordinate clicks were used for the four question types, manual protection, explicit confirmation, free-text editing, reset, re-fitting and final-test freezing. Nine answer dimensions and eight dialogue rows appeared. Completion cleared inspection traces. No runtime errors, media request, external-origin resource request, persistent storage entry or horizontal overflow occurred.
- All demo measurements/labels are scripted original fictional fixtures. Its perfect matches verify the numerical/UI contract and do not measure live Jev, unknown Japanese speech, or generalization. The quoted Claude/GPT result is not reproduced.

The baseline record below describes the original independent core checks; this feature run does not count the old service as a successful new live experiment.

2026-10-09. These checks concern this independent implementation, not the running reference service.

## Automated checks

- Node.js 22.18.0 and npm 10.9.3.
- `npm test`: 98 passing tests, no failures or skips. The build includes strict TypeScript compilation.
- `npm run typecheck`: passed.
- Synthetic coverage includes all four question types, conditional-answer pruning, manual and confirmed answer protection, speech-start cancellation, ignored aborts, rolling dialogue memory, Jev schema/probability validation, both providers' message contracts, silent feedback, late media cleanup, camera consent/expiry and authenticated bounded server routes.
- The OpenAI barge-in case explicitly checks that completion of old output cannot reopen context sharing while the respondent speaks.

## Browser checks

The fictional offline demo was operated in Chrome with a 390 × 844 CSS-pixel viewport. Single choice, multiple choice, scale and exact free text were taken from proposal through explicit confirmation into native host form controls. Manual correction, free-text editing/focus, eight analysis rows, separately displayed synthetic camera observations, completion and reset were checked. There was no horizontal overflow, runtime error, external-origin request, media-permission request or persistent storage entry in that offline flow.

A separate browser setup used a synthetic VoiceConnection, synthetic decisions and a rejected media-permission mock. It checked voice/camera consent gates, grounded optional introduction, exclusion of introduction speech from Jev calls, profile reset, question-phase connection replacement, stopping and profile cleanup on destruction. This was a test of the widget's controls and lifecycle, not a connection to an AI provider or a real camera.

## Distribution checks

- A public-file pattern check rejects credential files, private home paths, deployment hosts, key-shaped strings and respondent email addresses. The exact published copyright contacts in generated dependency notices are retained for attribution.
- Gitleaks 8.30.1 with the default rules, no project exclusions and no inline suppression is used on the staged source export, extracted npm package and full fresh Git history. Reports stay outside the public repository and secrets are redacted in scanner output.
- The package file list is inspected for environment files, private Git objects, node_modules, source maps, recordings, images and archives. Only the independently authored library/demo/docs and required dependency notices are shipped.
- Production dependencies reported zero known vulnerabilities in `npm audit --omit=dev` at the time of the check.

See [PROVENANCE.md](../PROVENANCE.md) and [THIRD_PARTY.md](../THIRD_PARTY.md) for the source/license boundary. Scans and tests are evidence for the checked contents and behavior; they are not a legal certification or a guarantee of natural-language accuracy.

## Remaining live validation

Paid TypeSafe/Gemini/OpenAI requests, real Japanese speech/transcription/classification quality, microphone playback on actual devices, iPhone/Safari behavior and real image-observation accuracy were not tested in this run. The host must configure its own keys, available models, authentication, budget and data-retention policy and validate its own survey. No result from the earlier prototype is counted as a successful live test of this rewrite.
