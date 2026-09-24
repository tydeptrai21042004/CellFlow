# Vercel Deployment Specification

## Objective

A CKBuilder should be able to deploy CellFlow without running Docker, Redis, a CKB node, or a permanent worker.

## Reference stack

- Next.js on Vercel for UI and APIs.
- Vercel Workflows for durable reconciliation.
- Neon PostgreSQL for persistence.
- User-provided CKB RPC endpoint.
- Optional Vercel Cron for maintenance sweeps only; correctness must not depend exclusively on cron.

## Required environment variables

```env
DATABASE_URL=
CKB_NETWORK=testnet
CKB_RPC_URL=
CELLFLOW_MASTER_SECRET=
WEBHOOK_SIGNING_SECRET=
NEXT_PUBLIC_APP_URL=
```

Optional:

```env
CKB_RPC_FALLBACK_URL=
LOG_LEVEL=info
DEFAULT_CONFIRMATION_POLICY=committed
```

## Deployment flow

1. Fork repository.
2. Click `Deploy with Vercel`.
3. Provision/connect Neon.
4. Add CKB RPC URL and secrets.
5. Run migration step.
6. Health check `/api/health`.
7. Create initial project/API key from setup screen.
8. Track a supplied testnet fixture transaction.

## Serverless design constraints

- Never depend on process memory for intent or retry state.
- Every workflow step must be retry-safe.
- Database writes should use unique constraints and transactions.
- Avoid database locks across network calls.
- Keep RPC calls outside long DB transactions.
- Use bounded retries plus durable delayed continuation.
- Treat deployment/restart as a normal event.

## Health endpoints

`/api/health` checks application and DB connectivity.

`/api/health/rpc` checks CKB RPC separately and must not make the whole dashboard unavailable if RPC is down.

`/api/health/workflows` verifies workflow registration/configuration.

## Demo vs production profile

### Demo
Public testnet RPC is acceptable with a visible warning.

### Production
Require operator-controlled or contracted RPC infrastructure. The product should never claim public RPC has production SLA.

## Deployment acceptance test

A clean Vercel project is considered successfully deployed when a reviewer can:

- open the dashboard;
- create a project;
- obtain API credentials;
- track a real testnet transaction;
- observe state transition;
- export evidence JSON;
- receive a signed webhook.
