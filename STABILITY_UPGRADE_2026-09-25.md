# CellFlow stability and operations upgrade — 2026-09-25

This upgrade keeps the V0.2 durable-transaction model intact and improves the parts most likely to cause operational incidents in a real Vercel + PostgreSQL + CKB deployment.

## Added features

### Deployment readiness

`GET /api/ready` now checks:

- PostgreSQL connectivity;
- CKB RPC reachability;
- `CELLFLOW_ENCRYPTION_KEY` presence and minimum length;
- `CRON_SECRET` presence and minimum length.

It returns HTTP 503 when the deployment should not be considered ready.

### Multi-RPC failover

Reconciliation and RPC health checks support these sources in order:

1. project-specific RPC URL;
2. `CKB_RPC_URL`;
3. `CKB_RPC_FALLBACK_URL`;
4. `CKB_RPC_FALLBACK_URLS` as a comma/whitespace-separated list.

Duplicate and invalid URLs are removed before use. `CKB_RPC_TIMEOUT_MS` is clamped to 1–30 seconds.

### Durable operator notes

Operators can append a note from the intent drawer. Notes are persisted as `OPERATOR_NOTE` state events and use the same transactional event/webhook-outbox path as lifecycle events, providing an auditable record for incidents, customer references, manual verification and recovery decisions.

API: `POST /api/v1/intents/:intentId/notes` with `{ "note": "..." }`.

### Webhook operations

Webhook management now includes:

- delivered / pending / failed delivery counters;
- disabled endpoint visibility;
- non-destructive disable through `DELETE /api/v1/webhooks/:endpointId`;
- re-adding the same URL re-enables the endpoint and rotates its signing secret.

Historical delivery rows are retained when an endpoint is disabled.

## Reliability hardening

### Failure-isolated maintenance

The maintenance route uses `Promise.allSettled` for reconciliation, webhook delivery and rate-limit cleanup. One subsystem failing no longer prevents the other maintenance work from completing. Partial runs return HTTP 207 with per-task status.

### Bounded request parsing

JSON request bodies are capped by `CELLFLOW_MAX_JSON_BODY_BYTES` (default 256 KiB, clamped between 1 KiB and 2 MiB). Oversized requests return `REQUEST_TOO_LARGE` (413); malformed JSON returns `INVALID_JSON` (400).

### Health visibility

The dashboard now shows DB health, CKB RPC health/tip/latency, and aggregate deployment readiness. KPI cards are computed from project-wide database aggregates, so totals remain correct even when the table only loads the 200 most recent intents.

## Packaging fix

The source archive was missing `.env.example`, causing two existing repository tests to fail before any code change. The file is restored with all required and newly added environment variables.

## Verification

- `npm test`: 65 tests pass in the current V0.3 tree (the stability layer described here remains covered).
- `tsc -p tsconfig.check.json --noEmit --noCheck`: passes, validating syntax/module parsing across the TypeScript tree in the available environment.
- Full dependency-resolved strict typecheck/build requires installing workspace dependencies first (`npm install`); the supplied environment did not have the project dependency tree preinstalled.
