# Security

Long-term keys belong on the host server. Authenticate and authorize survey access before issuing short-lived voice credentials or accepting transcript/image analysis requests. Apply distributed request and budget limits for shared deployments. Never rely on an Origin check as authentication.

Report a reproducible boundary failure privately through the repository's security advisory mechanism when available. Do not post live keys, transcripts, images or actual respondent answers in an issue. Use a synthetic reproducer.

This repository contains an offline demo and loopback-only server example. It does not configure production accounts or provider retention. See docs/PRIVACY.md and docs/INTEGRATION.md for the implemented limits and host responsibilities.
