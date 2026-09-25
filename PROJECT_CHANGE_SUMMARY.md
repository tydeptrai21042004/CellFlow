# CellFlow V0.2 change summary

V0.2 hardens the runnable V0.1 implementation around correctness, CKB-native state verification, concurrent serverless execution, and production operations. It deliberately avoids unrelated feature expansion.

## P0 correctness changes

- Fixed CCC signing so a transaction is prepared/signed once, hashed before broadcast, and persisted before the network side effect.
- Separated ambiguous broadcast failure from post-broadcast tracking-update failure.
- Made intent creation and execution transitions atomic with their audit event and webhook outbox records.
- Added explicit optimistic-concurrency errors and bounded reconciliation retry instead of silently accepting lost updates.
- Added database leases with `FOR UPDATE ... SKIP LOCKED` for reconciliation and webhook workers.
- Added workflow-start claims/deduplication so repeated API requests do not freely create parallel durable workflows.
- Suppressed duplicate state events/webhooks when polling observes no meaningful lifecycle change.
- Fixed confirmed transactions with pending assertions so reconciliation continues until the assertion is verified or fails.

## CKB-native verification

- One reconciliation observation now remains on one CKB RPC endpoint.
- Reorg detection checks canonical block hashes rather than treating a lagging `pending`/`proposed` observation as proof of reorg.
- A prior canonical commit is preserved across uncertain/lagging observations.
- Expected Cell assertions support `mode: created` and `mode: live`; live mode resolves the transaction OutPoint through `get_live_cell`.
- Capacity checks use integer equivalence instead of raw hex-string equality.
- Empty expected-Cell assertions are rejected.

## Security and multi-tenant hardening

- Split `CELLFLOW_ENCRYPTION_KEY` from the browser-facing bootstrap token.
- Added `CELLFLOW_SETUP_ENABLED` so project bootstrap can be disabled after first deployment.
- Browser service API keys are held only in page memory, not Web Storage.
- Added project API-key creation/list/revocation endpoints.
- Added per-project database-backed API rate limits.
- Hardened SSRF checks, including IPv4-mapped/translated IPv6 forms.
- Project RPC URLs are validated as public HTTPS destinations at setup.
- Webhook test delivery is project-scoped.

## Operations and evidence

- Added versioned SQL migration tracking through `schema_migrations`.
- Added lifecycle database `CHECK` constraints and worker indexes.
- Evidence exports are persisted/deduplicated with SHA-256, schema version, and event-sequence boundary.
- Added a zero-dependency operator CLI with `doctor`, intent/reconcile/evidence, and API-key commands.
- Updated OpenAPI, deployment/security docs, CI, project tree, and implementation status.

## Automated verification in this release

- 12 core lifecycle/reorg tests.
- 5 expected-Cell assertion tests.
- 6 repository/security/tree hardening tests.
- 23 total dependency-free tests passing.
- TypeScript/TSX syntax audit and internal type-consistency audit.
- OpenAPI YAML and JSON manifest validation.

## Deliberately outside V0.2

Fiber/RGB++ orchestration, multi-chain support, billing, custody/private-key management, automatic replacement transactions, and a generalized smart-contract assertion DSL remain outside the focused CKB transaction-recovery/state-verification boundary.
