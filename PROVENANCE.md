# Provenance and license boundary

2026-10-10 feature version: this separate experimental branch reuses the independently authored MIT public core at `8cb97b984225da2210ce325552e9c53f2d2c5ba6`. The new feature schemas, Jev score client, regularized linear learner, designer interface, CLI, inspection UI and fictional fixtures were independently authored for this branch. No original unlicensed service modules, private environment, production data or recordings were added. The public `main` baseline is retained. TypeSafe's official API/model/pattern documentation informed the contracts; no cookbook implementation or external dataset was copied. The original core provenance below still applies to reused files.

2026-10-09. This repository was written as a new implementation, starting from an empty directory and a new Git history. No previous working tree, Git objects, deployed bundle, copied application module, image, recording, response data, environment file or credential was imported.

The functional reference was the latest deployed Jev voice-interview prototype, version 3, source baseline `f08590a21bbb02d6ae683c6d58b11835cacd5609`. Read-only Sites version/deployment metadata and a matching clean local checkout identified the baseline. The public interview screen and the prototype's functional notes were inspected. No production sessions were started and no production database, answer rows, worker logs or environment settings were requested. Private paths and deployment identifiers are intentionally absent here.

The earlier local Voice Survey Core documented borrowed provenance for its voice adapters, audio worklet and lifecycle tests. Its upstream service was based on [Louis-Takeuchi/oshisen](https://github.com/Louis-Takeuchi/oshisen). A public repository without an explicit license was not treated as permission to redistribute or relicense it. That earlier core and the service's additions remain outside this distribution.

| Earlier material | Treatment here | Independently written replacement |
| --- | --- | --- |
| Core provider adapters and HTTP starter | Excluded; no source copied | `src/providers/openai.ts`, `gemini.ts`, `audio.ts`, `src/http.ts` |
| Existing AudioWorklet | Excluded | `src/pcm.ts`, `src/capture-worklet.ts`, area-average streaming resampling |
| Existing lifecycle and domain tests | Excluded | Synthetic tests under `tests/`, created around this repository's API |
| Service survey, answer mapping and prompts | Excluded | `src/survey.ts`, `controller.ts`, `jev.ts`, `server/instructions.ts` |
| Jev dashboard and camera application code | Excluded | `src/dialogue.ts`, `interview.ts`, `camera.ts`, `widget.ts`, server endpoints |
| Service branding, political data, scoring, user profiles and response storage | Excluded | Fictional workshop configuration, original HTML/CSS and host callbacks |
| Private source history and production configuration | Excluded | Fresh history and empty environment example |

The replacement follows the same behavioral requirements where useful: explicit confirmation, manual correction, separate Jev answer/context routes, eight analysis dimensions, bounded transcript memory, opt-in camera observation and silent feedback. Matching behavior is not a claim to ownership of the upstream implementation.

The code, demo text, UI, tests and documentation in this repository were newly authored. There are no stock media assets or copied third-party illustrations. MIT applies to this independently authored work. The Google SDK and build dependencies have their own published licenses; see THIRD_PARTY.md. API operation names and schemas were implemented using official documentation rather than upstream application source.

This is a documented independent rewrite, not a claim that a formal legal clean-room process or external legal certification has taken place. Permission is still needed before distributing any excluded upstream implementation. No excluded implementation is required to build or run this repository.
