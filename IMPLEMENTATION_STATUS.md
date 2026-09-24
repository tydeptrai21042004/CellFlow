# Implementation Status — v0.1

## Implemented

- Core three-axis status model and overall projection.
- Confirmation-depth policy and explicit reorg handling.
- PostgreSQL schema, migrations and tenant-scoped repository methods.
- Project/API-key bootstrap with hashed API keys.
- Idempotent intent creation via database unique constraint.
- Next.js 16 API routes and operational dashboard.
- CKB JSON-RPC reconciliation.
- Vercel Workflow durable reconciliation loop.
- Cron repair sweep.
- CCC pre-broadcast deterministic tx-hash integration.
- Expected Cell assertions.
- HMAC webhook signing/verification, encrypted endpoint secrets and retry records.
- Public-address-only, DNS-pinned webhook transport.
- Evidence export.
- Core automated tests and GitHub Actions CI definition.

## Requires deployment environment to exercise end to end

These are integration/runtime checks rather than missing source implementation:

1. `npm install` and `npm run build` in an internet-enabled environment.
2. Apply migration to an actual PostgreSQL/Neon database.
3. Run a real CKB testnet transaction through the CCC helper.
4. Observe Workflow SDK execution on Vercel.
5. Register a public HTTPS webhook receiver and verify retry behavior.
6. Run the failure scenarios against controllable RPC/network faults.

## Not claimed by v0.1

- signing or key custody;
- fee bumping/replacement;
- Fiber/RGB++ orchestration;
- general multi-chain support;
- an indexer/explorer;
- billing/multi-region SaaS control plane;
- completed independent external CKBuilder adoption validation.
