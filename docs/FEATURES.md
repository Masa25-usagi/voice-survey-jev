# Implementation and verification scope

Baseline: latest Jev prototype version 3, source fingerprint `f08590a21bbb02d6ae683c6d58b11835cacd5609`. This repository implements its reusable behavior independently. It does not import or replace the running prototype.

| Baseline behavior | Independent implementation | Verification |
| --- | --- | --- |
| Direct voice conversation + Jev answer mapping | Gemini Live / OpenAI Realtime adapters; separate server-owned answer route | Synthetic protocol, cancellation, startup/late-media tests |
| Both speakers' transcripts, user evidence only | Role-tagged final events, interviewer-as-context instructions, assistant-only guard | Request-shape and lifecycle tests; semantic correctness remains a live-model evaluation task |
| Draft, manual edit, confirm, next | Controller and widget; manual answers cannot be overwritten | State tests and offline browser flow |
| No position, knowledge shortage and refusal | Separate typed decisions; no forced midpoint value | Jev contract tests |
| Long conversation / later correction | 48-turn, 8,000-per-turn, 12,000-total rolling memory; debounce and request epochs | Long-turn and stale-response tests |
| Optional introduction/profile | Host-defined draft fields, explicit evidence terms, manual protection/reset; introduction is not classified as survey speech | Grounding tests and session-prompt boundary tests |
| Optional camera | Separate consent, capture and image endpoint; fixed conditions and face-shape enums; no diagnosis | Consent, late-permission, cleanup and fixed-schema tests |
| Eight analysis dimensions | Separate Jev context request and optional details dashboard | Eight-field contract tests; response UI verified with fixtures |
| Camera observation vs conversational response | Observations displayed separately; expiry, poor-quality and no-camera fallbacks | Contract/expiry tests; synthetic observation fixture |
| Feedback to the voice model | Gemini turnComplete:false / OpenAI conversation.item.create at idle state | Synthetic adapter messages and pending/shared tests; no response.create for analysis sharing |
| Sources and explanation | Host-defined text/source packs, user-visible panel and show_sources tool | Survey URL validation and UI rendering |
| Host survey integration | Four question types, earlier-answer conditions, callbacks, native form binding and explicit prefill link generation | Controller/integration tests and offline browser form |

The prototype's default political five-choice questionnaire is replaced by configurable host options. No political scoring, candidate database, service authentication, account or budget configuration is copied. The host owns these responsibilities. A deployment already using its own questionnaire can supply the same option IDs and consume only confirmed outputs.

The optional introduction defaults to explicit speaking preferences. Host-defined generation/gender/region fields can be configured but are not inferred from a face, guessed when missing, or passed into conversation adaptation. This library does not ship any real personal profile.

The following are implementation choices, not claims of a byte-identical extraction:

- Question/model changes restart the voice connection to isolate old untagged transcript events. The host should account for latency and session fees.
- Multiple-choice and numeric-scale mapping are generalizations of the original single-choice case.
- Free-text drafts preserve the respondent's exact latest words instead of asking a decision-only model to generate text. They still require explicit review.
- The camera observer is configured by the host and disabled by default; no borrowed visual assets are needed.
- No automatic remote survey submission, SaaS schema scraping, ranking/matrix question mapper or cross-account survey administration is included. Controlled framework forms use callbacks, not native DOM binding.
- Provider costs, long-session resumption, comparative real-model evaluation and persistent evaluation analytics remain host concerns. Basic Jev model, token usage, analysis time and latency are available in in-memory results; no speech/profile is written to a metrics file.

Tests and browser checks use only fictional statements, mock media, fake provider responses and synthetic observations. They do not demonstrate Japanese classification accuracy, speech naturalness, real iPhone/Safari microphone behavior, face-reading accuracy, paid API access, provider retention guarantees or migration of the live site. The prior prototype's successful real-API checks are not claimed as tests of this new implementation.

Run `npm test` and `npm run typecheck`. The offline browser flow can be repeated with `npm run demo`: replay an example, inspect the unconfirmed candidate, manually change it, confirm, and check the host form. Repeat for multiple choice, scale and exact free text; inspect the optional eight-row dashboard. The scripted demo must never request media permission or contact an external origin.
