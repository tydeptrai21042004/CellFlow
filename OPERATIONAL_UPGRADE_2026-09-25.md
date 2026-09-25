# CellFlow operational reliability and scalability upgrade — 2026-09-25

This pass builds on the security-hardened V0.3 tree and focuses on reliability, scale, operator ergonomics, and release correctness without expanding CellFlow beyond its durable CKB transaction-operations boundary.

## Implemented

### Durable chain identity
- Custom project RPC setup verifies the endpoint genesis hash and persists it as `projects.rpc_genesis_hash`.
- Reconciliation prefers the persisted project genesis identity over deployment-global configuration.
- Migration `004_operational_scalability.sql` adds a format constraint for the stored genesis hash.

### Scalable intent history
- `/api/v1/intents` supports opaque keyset cursors (`nextCursor`).
- Ordering is stable on `(created_at DESC, id DESC)` and migration 004 adds the matching project index.
- The operator console can load older intent pages without offset scans or a hard 200-row ceiling.

### Worker reliability
- Reconciliation and webhook leases are renewable per item.
- Batch leases account for queue waiting time and worker concurrency is bounded by environment controls.
- The daily maintenance endpoint is intentionally a small repair sweep so it is less likely to exceed serverless duration limits.
- Webhook test delivery targets the test event itself rather than draining unrelated project backlog.

### Webhook behavior
- Retryable responses honor bounded `Retry-After` guidance.
- Total delivery attempts are configurable and bounded.
- Deliveries include `X-CellFlow-Attempt` for receiver-side diagnostics.

### Readiness and operations
- `/api/ready` verifies migration `004_operational_scalability.sql` is applied.
- `/api/health` returns HTTP 503 if the database liveness check is false.
- Browser and CLI calls send correlation IDs; error responses/logs reuse valid caller IDs.
- CLI `doctor` now checks health, RPC, readiness and authenticated operations, with additional `ready`, `operations`, `webhooks`, and `project-evidence` commands.

### Documentation and release contracts
- OpenAPI documents keyset pagination and read-only vs persisted intent evidence.
- Runbook documents schema readiness, project genesis identity, bounded maintenance and Retry-After behavior.
- Release preflight requires migration 004 and the new worker tuning environment variables.

## Validation

- `npm test`: **81/81 deterministic tests passing**.
- `npm run verify`: deterministic suite plus critical implementation-tree verification passing.
- CLI JavaScript syntax check and help invocation pass.
- Release preflight fails closed on the one known release blocker: missing `package-lock.json`.

## Remaining release gate

The source environment cannot resolve npm registry dependencies, so a truthful release still requires generating and committing `package-lock.json` in a network-enabled environment, then running `npm ci`, full workspace `npm run typecheck`, and `npm run build`. The codebase intentionally keeps this as a blocker instead of weakening the release gate.
