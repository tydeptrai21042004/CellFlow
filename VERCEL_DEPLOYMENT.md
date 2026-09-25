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
CELLFLOW_ENCRYPTION_KEY=
CELLFLOW_BOOTSTRAP_TOKEN=
CELLFLOW_SETUP_ENABLED=true
CELLFLOW_RATE_LIMIT_PER_MINUTE=240
CRON_SECRET=
NEXT_PUBLIC_APP_URL=
DEFAULT_CONFIRMATION_POLICY=depth:4
```

`CELLFLOW_ENCRYPTION_KEY`, `CELLFLOW_BOOTSTRAP_TOKEN`, and `CRON_SECRET` must be separate high-entropy values. The encryption key is server-only and must never be entered in the browser. `CELLFLOW_BOOTSTRAP_TOKEN` is used only to create the initial project/API key. After bootstrap, set `CELLFLOW_SETUP_ENABLED=false` in production and redeploy.

## Deploy

1. Import the repository into Vercel and leave the project Root Directory at the monorepo root. The committed `vercel.json` builds `@cellflow/web` and publishes `apps/web/.next`.
2. Provision/connect Neon PostgreSQL.
3. Add the environment variables above.
4. Run `npm install` once in a network-enabled environment and commit the generated `package-lock.json`; production/CI can then use `npm ci`.
5. Run `npm run migrate` against the production database.
6. Deploy the Next.js project.
7. Open `/api/health` and `/api/health/rpc`.
8. Open `/` and use the First deploy panel with `CELLFLOW_BOOTSTRAP_TOKEN` to create the first project.
9. Copy the returned API key once, then disable setup for production.
10. Track a CKB testnet transaction.
11. Verify the run in Vercel Workflows and export evidence.

## Durability model

The workflow function contains orchestration/sleep only. CKB/database side effects occur in workflow steps. PostgreSQL remains authoritative. V0.2 uses optimistic version checks, reconciliation leases, workflow-start deduplication, webhook-delivery leases, and a transactional state-event/webhook-outbox path so overlapping serverless invocations cannot silently overwrite lifecycle state.

`/api/internal/maintenance` is configured in `vercel.json` and repairs due reconciliation/webhook work if a workflow was not started or reached its bounded horizon.

## Health

- `/api/health` — application + database.
- `/api/health/rpc` — CKB RPC separately; an RPC outage does not make the dashboard itself unavailable.
- `cellflow doctor` — operator CLI check for application/RPC reachability and authenticated API access.
