# Verification record

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
