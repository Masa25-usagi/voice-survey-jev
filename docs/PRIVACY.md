# Data boundaries

The source, sample survey, scripts and fixtures contain fictional content. There are no real recordings, camera images, demographic profiles, health histories, private accounts or respondent answers in the distribution. Long-term keys are empty environment variables in an example file; the project includes no credential.

| Data | Where used | Lifetime / output |
| --- | --- | --- |
| Microphone audio | Chosen voice provider after user consent | Streamed; this library makes no recording |
| Final user/assistant text | Browser rolling buffer and authorized Jev routes | Current question only; bounded to 48 turns / 12,000 characters |
| Draft answer | Controller | In-memory until replaced, cleared or confirmed |
| Confirmed answer | Controller and explicit host callback | Host owns any subsequent storage or submission |
| Profile | Optional browser draft | Reset/clear on widget destruction; introduction speech is not sent to Jev |
| Speaking preferences | Voice session instructions | Only explicit speed/detail/example choices; demographic fields are excluded |
| Camera frame | Separate authorized image endpoint | A single JPEG in memory; no raw image returned or sent to Jev |
| Camera observation | Context analysis | Fixed fields; expires after 30 seconds |
| Dialogue analysis | Optional details UI and silent voice context | In-memory; latest explicit transcript excerpt is displayed only locally |
| Provider token / SDP | Browser connection setup | Short-lived constrained Gemini token or OpenAI SDP; no long-term key |

The answer classifier state is constructed explicitly from the server-owned question and normalized transcript fields. Additional client camera, identity, profile, prompt and metadata fields are ignored. The context classifier cannot generate, select or confirm an answer. Camera results affect only gentle conversation adjustments. Low-quality imagery clears facial observations; absent, expired or stopped camera input produces no visual adjustment.

The server endpoint does not log request bodies, provider errors or credentials. It uses no-store responses, bounded inputs, authorization callbacks, abort signals and timeouts. A host must also configure its reverse proxy, framework, observability, provider contracts and response persistence appropriately; this library cannot control an application's external logging or storage.

Stopping, question navigation, model switching, pagehide and visibility loss release the media tracks and current transcript/analysis memory. Late media permission and connection results are disposed. A new connection isolates provider events between questions; reconnection may create new billable sessions. SDK cancellation cannot retract a request already accepted by a provider.

Confidence thresholds are routing heuristics, not estimates of guaranteed accuracy. User confirmation does not prove model understanding. These guards protect application state; natural-language instructions alone do not prove that a model will never infer an unsupported answer or make a biased explanation. Test your own survey language and content.

API providers have their own data retention and billing conditions. This library does not promise zero data retention, medical/psychological analysis, emotion recognition or performance on real faces. See each provider's current policy before configuring a live deployment:

- [TypeSafe legal information](https://docs.typesafe.ai/legal)
- [Google Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [OpenAI API data controls](https://platform.openai.com/docs/guides/your-data)

`prefillUrl` explicitly places confirmed answers in a query string. Use it only when that is appropriate for your host's data flow. It does not open, share or submit the link automatically.
