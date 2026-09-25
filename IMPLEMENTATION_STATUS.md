# Implementation status — V0.3 production candidate

CellFlow is an implemented CKB-focused transaction-operations layer with durable recovery, a production-oriented control plane, and reviewer-verifiable evidence paths.

## Implemented

### Transaction safety and recovery

- Next.js/Vercel API and operations dashboard.
- PostgreSQL durable source of truth and versioned migrations.
- Idempotent business intents and deterministic pre-broadcast transaction identity.
- Separate submission, chain and workflow status axes.
- CKB RPC reconciliation with one-endpoint-per-observation semantics, confirmation depth, and explicit canonical-block reorg checks.
- Created-Cell and live-Cell assertions.
- Ambiguous broadcast recovery by previously persisted transaction hash; no blind automatic rebroadcast.
- Optimistic concurrency retries, reconciliation leases, durable Workflow starts, and an atomic event/webhook outbox.

### Production control plane

- Multiple RPC endpoints, bounded RPC timeout, endpoint failover, and cooldown circuit breaking.
- Readiness validation for database, RPC, secrets, chain identity, optional genesis pin, fallback topology, and production setup lock.
- Scoped and expiring API keys (`read`, `write`, `admin`) with database-backed rate limiting.
- Signed webhook delivery with encrypted endpoint secrets, DNS-pinned SSRF protection, leases, delivery health, endpoint disable, and failed-delivery replay.
- Operational health metrics for reconciliation backlog, leased work, stale active intents, webhook backlog, API-key expiry, and recent event activity.
- Persisted deterministic per-intent evidence and hashed project-level reviewer evidence snapshots.
- Durable operator notes in the event timeline.
- Bounded request bodies, stable API errors, request IDs, structured error logging, no-store API responses, and defensive browser headers.
- Zero-dependency operator CLI, OpenAPI contract, runbook, security policy, reviewer-verification guide, and CI release contract.

## Validation in this exported ZIP

- Core lifecycle/reorg suite: **22 passing**.
- Cell assertion suite: **11 passing**.
- Runtime/hardening/UI/stability/production-readiness suite: **29 passing**.
- Total deterministic suite: **65/65 passing**.

## Release gates that still require a networked/staging environment

The export environment has no usable npm-registry access, and the source repository did not include a dependency lockfile. Therefore this package does **not** claim that a dependency-resolved `npm ci`, full workspace typecheck, or Next.js production build was executed here.

Before a public production/mainnet release:

1. Generate and commit `package-lock.json`; CI intentionally treats a missing lockfile as a release blocker.
2. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` on Node 22 in a clean network-enabled runner.
3. Apply all migrations to a staging database and validate backup/restore.
4. Pin the expected CKB genesis hash and use at least two independently operated RPC endpoints.
5. Exercise ambiguous broadcast, RPC failure/failover, reorg detection, confirmation depth, webhook retry, credential rotation, and expected live-Cell assertions on CKB testnet.
6. Obtain an external security review before holding CellFlow out as mainnet production infrastructure.

## Funding-readiness evidence to collect next

- Public live deployment and exact release commit/tag.
- Recorded testnet lifecycle and injected-failure evidence.
- Project evidence JSON and intent evidence JSON from the live deployment.
- One independent external integration beyond the reference application.
- 30-day operational metrics: tracked operations, recovery events, webhook retry/success rate, reconciliation backlog, and manual-intervention count.
- Public security-review findings and remediation status when available.
