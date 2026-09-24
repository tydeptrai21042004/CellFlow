# Vercel Deployment

## Stack

- Next.js 16 on Vercel.
- Workflow SDK (`workflow/next`) for durable per-intent reconciliation.
- PostgreSQL/Neon as the durable source of truth.
- Vercel Cron as a repair sweep, not primary state ownership.
- Operator-provided CKB RPC.

## Environment

```env
DATABASE_URL=
CKB_NETWORK=testnet
CKB_RPC_URL=
CKB_RPC_FALLBACK_URL=
CELLFLOW_MASTER_SECRET=
CRON_SECRET=
NEXT_PUBLIC_APP_URL=
DEFAULT_CONFIRMATION_POLICY=depth:4
```

`CELLFLOW_MASTER_SECRET` and `CRON_SECRET` must be different high-entropy values. The application refuses to bootstrap projects if the master secret is shorter than 32 characters.

## Deploy

1. Import the repository into Vercel and leave the project Root Directory at the monorepo root. The committed `vercel.json` builds `@cellflow/web` and publishes `apps/web/.next`.
2. Provision/connect Neon PostgreSQL.
3. Add environment variables.
4. Run `npm run migrate` against the production database.
5. Deploy the Next.js project.
6. Open `/api/health` and `/api/health/rpc`.
7. Open `/` and use the First deploy panel to create a project.
8. Copy the returned API key once.
9. Track a CKB testnet transaction.
10. Verify the run in Vercel Workflows and export evidence.

## Durability model

The workflow function contains orchestration/sleep only. CKB/database side effects occur in workflow steps. Every reconciliation reads current PostgreSQL state before acting, and execution updates use optimistic version checks. A deploy can terminate a function instance without losing the logical transaction lifecycle.

`/api/internal/maintenance` is configured in `vercel.json` and processes due rows/webhooks if a workflow was not started or reached its bounded horizon.

## Health

- `/api/health` — application + database.
- `/api/health/rpc` — CKB RPC separately; an RPC outage does not make the dashboard itself unavailable.
