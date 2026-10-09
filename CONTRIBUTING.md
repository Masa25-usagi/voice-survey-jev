# Contributing

Run `npm ci`, `npm test`, `npm run typecheck` and `npm run check:public` before proposing a change. Use fictional transcripts and mocked providers. Never add live keys, access tokens, environment settings, raw recordings, camera frames, actual answers or private file paths to a fixture, screenshot, log or issue.

Preserve the explicit confirmation boundary, user corrections, stale-event guards and separation of answer mapping from camera/profile analysis. Include a behavioral test when changing one of those boundaries. Check the offline UI after changing the widget.

Do not import code or assets from an upstream repository without a compatible explicit license or documented permission. PROVENANCE.md records the earlier materials excluded from this independent implementation. A public repository alone is not a reuse license.

Report reproducible failures with a small invented survey and synthetic input. Live-provider quality reports should separate the model/account used, data-sharing consent and sample size from automated contract tests.
