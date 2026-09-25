# Implementation status — V0.2

CellFlow is now an implemented CKB-focused MVP with a hardened serverless concurrency model.

## Implemented

- Next.js/Vercel API and operations dashboard.
- PostgreSQL durable source of truth and versioned migrations.
- Idempotent business intents and deterministic pre-broadcast tx identity.
- Separate submission, chain and workflow status axes.
- CKB RPC reconciliation with same-endpoint observations, confirmation depth and explicit canonical-block reorg checks.
- Created-Cell and live-Cell assertions.
- Optimistic concurrency retries.
- Reconciliation leases and webhook-delivery leases using `SKIP LOCKED`.
- Deduplicated durable Workflow starts.
- Atomic state + event + webhook outbox creation.
- Signed webhook retries with DNS pinning/SSRF protection.
- Persisted deterministic evidence snapshots.
- Separate bootstrap/encryption secrets and database-backed request rate limiting.
- Zero-dependency operator CLI.
- OpenAPI contract, deployment documentation and CI definition.

## Validation status in this exported ZIP

- Core lifecycle/reorg suite: passing.
- Cell assertion suite: passing.
- Hardening/tree suite: passing.
- TypeScript/TSX syntax parse audit: passing.
- Full `npm install`, strict workspace typecheck and `next build`: not executable in the export environment because npm registry access is unavailable. CI performs these steps in a network-enabled runner.

## Recommended next validation before public production use

1. Run `npm install` and commit the generated `package-lock.json`.
2. Run `npm run migrate && npm test && npm run typecheck && npm run build`.
3. Run a real CKB testnet Alice→Bob integration with `mode: live` assertion evidence.
4. Add a second independent CKBuilder integration to validate the reusable API boundary.
