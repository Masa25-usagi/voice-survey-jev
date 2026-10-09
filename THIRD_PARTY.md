# Third-party dependencies

| Dependency | Use | License |
| --- | --- | --- |
| [@google/genai](https://github.com/googleapis/js-genai) | Gemini Live client, constrained token issuance and optional image observation | Apache-2.0 |
| [TypeScript](https://github.com/microsoft/TypeScript) | Type checking and ESM/type declaration build | Apache-2.0 |
| [esbuild](https://github.com/evanw/esbuild) | Offline demo browser bundle | MIT |

Versions and transitive dependencies are pinned in package-lock.json. They are installed from their published packages, not from the unlicensed survey projects. Dependencies retain their original licenses; the repository's MIT license does not relicense them.

The demo build preserves legal comments and generates `demo/THIRD_PARTY_LICENSES.txt` from the exact dependency packages bundled into it. These notices are included in the package alongside the browser bundle, including the dependency authors' published copyright contacts. These are dependency attribution, not data about a survey respondent. Build tools themselves are not embedded in the demo. The source distribution contains no vendored copy of the original service.

Protocol references, checked 2026-10-09:

- [TypeSafe evaluation API](https://docs.typesafe.ai/api) and [models](https://docs.typesafe.ai/models)
- [Google Live API](https://ai.google.dev/gemini-api/docs/live-api) and [ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)

No tutorial code samples or prose passages were copied into the implementation. These references establish API contracts; provider access, pricing, model availability and retention are controlled by each provider.
