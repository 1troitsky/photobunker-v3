# PB3 — configurable-brand privacy media application

**Status: P0 / preparation.** This is a new, independent implementation repository, not a deployment or automatically merged copy of PB2.

**Start here:** [Normative specification](ts.md) · [engineering rules](AGENTS.md) · [P0 delivery](docs/planning/P0-DELIVERY.md) · [source provenance](docs/architecture/PB2-PROVENANCE.md).

## Release scope

P0 setup, then **four mandatory phases**: P1 encrypted media/identity/storage; P2 accepted Fieldwork UI + Matrix Messenger; P3 Recovery Vault, payments, safety, admin, signed PWA; P4 personal/backup S3, Unlimited+ Matrix homeserver and full release readiness. IPFS is not included.

Frontend and product name are configurable. Latest source UX: [PB2 PR #56, commit daca24a4](https://github.com/1troitsky/photobunker-new/tree/daca24a4a38c62473859b2b54b4999d50400c491/docs/ux). Do not copy demo UI code and claim production integration.

## Current execution state

Only P0 guardrails, reference documents and configuration are being introduced. The Laravel/Vue application, database schema, real media sync, Matrix and production PWA are **not implemented in this repository yet**.

Backend security floor: **PHP 8.4.27+ before 8.5 or PHP 8.5.12+ before 8.6; Laravel >=13.4 <14.** Deployment must satisfy the same gate.
