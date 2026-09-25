> **Superseded for the current export:** see `V0.3_CHANGED_FILES.md` for the production/funding upgrade. This file is retained as the earlier stability-upgrade manifest.

# Changed files manifest — stability/feature upgrade (2026-09-25)

## New files

- `.env.example` — restored missing deployment template and added fallback/time/body-limit configuration.
- `.gitignore` — prevents secrets, local env files, dependencies, Vercel output and generated artifacts from being committed.
- `STABILITY_UPGRADE_2026-09-25.md` — implementation and verification notes.
- `apps/web/app/api/ready/route.ts` — deployment readiness endpoint.
- `apps/web/app/api/v1/metrics/route.ts` — project-wide operational KPI endpoint.
- `apps/web/app/api/v1/intents/[intentId]/notes/route.ts` — durable operator-note API.
- `apps/web/app/api/v1/webhooks/[endpointId]/route.ts` — non-destructive webhook disable API.
- `tests/runtime/stability-upgrade.test.mjs` — regression checks for this upgrade.

## Modified files

- `README.md`
- `UI_PRODUCTION_UPGRADE.md`
- `package.json`
- `packages/core/src/errors.ts`
- `packages/db/src/repository.ts`
- `workflows/reconcile/src/rpc.ts`
- `workflows/reconcile/src/reconcile.ts`
- `apps/api/src/schemas.ts`
- `apps/api/src/service.ts`
- `apps/web/lib/server.ts`
- `apps/web/app/api/health/rpc/route.ts`
- `apps/web/app/api/internal/maintenance/route.ts`
- `apps/web/app/globals.css`
- `apps/web/components/Dashboard.tsx`
- `apps/web/components/IntentDrawer.tsx`
- `apps/web/components/IntegrationsPanel.tsx`

## Main changes

- multi-endpoint CKB RPC failover and configurable bounded timeout;
- deployment readiness checks;
- isolated maintenance/cron tasks with partial-success reporting;
- bounded JSON bodies and deterministic malformed/oversized input errors;
- durable operator notes in audit history and webhook outbox;
- webhook delivery health counters and endpoint disable/re-enable lifecycle;
- project-wide KPI aggregates independent of the 200-row dashboard table;
- restored `.env.example` packaging contract;
- 7 new stability regression tests, bringing the deterministic suite to 54 passing tests.
