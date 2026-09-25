# CellFlow V0.3 — Production Readiness Upgrade

This release moves CellFlow from a hardened MVP toward a production candidate without changing the core non-custodial transaction-recovery model.

## New controls

### Credential isolation

- API keys now carry explicit `read`, `write`, and `admin` scopes.
- Rotated keys are expiring by default.
- Authentication ignores revoked or expired keys.
- Rate-limit buckets are keyed by API-key identity rather than only project identity.
- The last genuinely active key cannot be revoked accidentally.

### RPC resilience and network safety

- Repeated endpoint failures trigger a bounded in-process circuit-breaker cooldown.
- Failover continues to independent configured RPC endpoints.
- Custom project RPCs are checked with `get_blockchain_info` and rejected if mainnet/testnet identity does not match the project.
- `/api/ready` validates configured CKB network identity, can pin `CKB_EXPECTED_GENESIS_HASH`, blocks plain HTTP RPC in production by default, reports a warning when only one RPC endpoint is configured, and redacts detailed posture from unauthenticated production callers.

### Operational visibility

- New `/api/v1/operations` reports reconciliation backlog, leases, stale active intents, webhook backlog/failures, and credential-expiry signals.
- The production dashboard surfaces these signals directly.
- Failed webhook deliveries can be explicitly requeued after an operator fixes the receiver.

### Evidence and funding verification

- `GET /api/v1/project-evidence` exports project-wide operational/adoption evidence with a SHA-256 document fingerprint without a write side effect.
- `POST /api/v1/project-evidence` requires admin scope and durably records the snapshot in `project_evidence_exports`.
- Evidence includes the release version and Vercel/custom commit SHA when available.
- Reviewer verification and operator runbooks are included under `docs/`.

### HTTP/platform hardening

- Error responses carry `x-request-id` correlation IDs and structured JSON logs.
- API responses receive no-cache/no-index headers.
- The web app disables the framework-powered header and adds browser security headers.
- Direct third-party dependency versions are pinned in package manifests.

## Required migration

Run:

```bash
npm run migrate
```

Migration `003_production_readiness.sql` adds scoped/expiring keys and project evidence exports. Migration `004_operational_scalability.sql` adds durable per-project RPC genesis identity plus pagination/worker-health indexes. `/api/ready` now verifies that migration 004 is applied.

## Release gate

The deterministic repository suite must pass. Before claiming a public production release, additionally generate/commit `package-lock.json` in a network-enabled environment and pass `npm ci`, `npm run typecheck`, and `npm run build` in CI.
