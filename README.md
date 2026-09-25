# CellFlow

**CKB-native durable transaction operations and recovery for TypeScript applications.**

CellFlow sits after transaction construction/signing and before application business finalization. It does not hold keys. It persists application intent, tracks CKB transaction state, survives serverless restarts, handles ambiguous broadcast outcomes, waits for configurable confirmation depth, detects reorg evidence, verifies expected output Cells, and emits signed webhooks.

## Implemented V0.3 production candidate

This repository now contains a runnable implementation rather than only the original blueprint:

- strict TypeScript domain/state-machine package;
- PostgreSQL/Neon schema and repository layer;
- database-enforced `(project_id, intent_id)` idempotency;
- separated **submission**, **chain**, and **workflow** status axes;
- CKB JSON-RPC reconciliation (`get_transaction`, `get_header`, `get_tip_header`, `get_block_hash`, `get_live_cell`) using one endpoint per observation;
- configurable confirmation policy (`committed` or `depth:N`);
- explicit reorg state rather than treating `COMMITTED` as permanently terminal;
- Vercel Workflow SDK durable reconciliation loop;
- Vercel Cron repair sweep as a secondary safety mechanism, with failure-isolated, bounded reconcile/webhook/cleanup tasks;
- CCC integration that calculates `tx.hash()` and persists it **before broadcast**;
- ambiguous-submit handling without automatic duplicate rebroadcast;
- expected-Cell assertions for output index/capacity/lock/type/data with `created` and current `live` modes;
- atomic state/event/webhook outbox writes, leased webhook retries, encrypted per-endpoint secrets and DNS-pinned SSRF protection;
- project/API-key bootstrap flow with separate bootstrap and encryption secrets plus DB-backed rate limiting;
- separated product surfaces: public overview (`/`), authenticated/live operator console (`/console`), isolated local-only walkthrough (`/demo`), and one-time provisioning (`/console/setup`);
- production-style operations console with DB/RPC/readiness health, RPC latency, project-wide KPI aggregates, keyset-paginated intent history, search/filtering, intent audit drawer and optional auto-refresh;
- persisted/deduplicated deterministic JSON evidence endpoint;
- optimistic concurrency retry, renewable reconciliation/webhook leases, bounded worker concurrency and deduplicated durable Workflow starts;
- zero-dependency `cellflow` operator CLI;
- interactive local-only SkillPass lifecycle example with REST/CCC integration snippets;
- API-key and signed-webhook management UI, including webhook delivery counters and non-destructive endpoint disable;
- durable operator notes recorded in the intent audit timeline and signed webhook outbox;
- bounded JSON request bodies with deterministic malformed/oversized request errors;
- multi-endpoint CKB RPC failover via primary, single fallback, or comma-separated fallback lists;
- least-privilege API keys with `read` / `write` / `admin` scopes and optional expiry;
- per-process RPC circuit breaking so unhealthy endpoints cool down instead of being hammered on every observation;
- deployment readiness checks that validate database, applied schema migration, secrets, RPC reachability, expected CKB network identity, optional pinned genesis hash, and production setup lock;
- operational backlog metrics for due/leased reconciliation, stale intents, webhook queues, API-key expiry, and last event activity;
- retryable webhook dead letters from both API and operations UI;
- machine-readable project-level evidence exports for reviewer/audit snapshots without exposing API-key material;
- security headers, browser/CLI request correlation IDs, structured server-side error logging, and no-store/no-index API responses;
- reproducible-release guardrails and a CI contract that requires a committed dependency lockfile before release;
- 81 deterministic lifecycle, reorg, assertion, hardening, stability, production-readiness, operational-scalability, UI-safety, route-separation and deployment-contract tests.

## Production hardening added September 25, 2026

V0.3 keeps the same non-custodial transaction model and adds a production-oriented control plane:

- `/api/ready` validates database access, secret strength/presence, CKB RPC connectivity, configured network identity, optional genesis pinning, production setup lock, and fallback topology;
- RPC configuration can fail over across `CKB_RPC_URL`, `CKB_RPC_FALLBACK_URL`, and comma-separated `CKB_RPC_FALLBACK_URLS`, with timeout bounds and endpoint circuit breaking;
- API keys are least-privilege and can be scoped to `read`, `write`, and/or `admin`, with optional expiry and last-live-admin safety on revocation;
- maintenance uses isolated task settlement so webhook delivery failure does not suppress reconciliation or cleanup;
- JSON request parsing enforces a configurable body ceiling and returns stable API errors for malformed/oversized input;
- operator notes are durable audit events and participate in the signed webhook outbox;
- webhook management exposes delivery health, non-destructive disable, and failed-delivery replay;
- `/api/v1/operations` exposes bounded operational backlog/staleness indicators;
- `/api/v1/project-evidence` exposes a read-only hashed reviewer snapshot; an explicit admin `POST` records a durable audit/export row without leaking API-key material;
- all API failures carry request IDs, and the web layer emits defensive browser/security headers.

See `PRODUCTION_READINESS_V0.3.md`, `SECURITY.md`, `docs/operations/RUNBOOK.md`, and `docs/funding/REVIEWER_VERIFICATION.md`.

### Operational reliability and scale pass

The latest pass keeps the V0.3 product boundary but strengthens non-security production behavior:

- verified genesis identity from a custom RPC is persisted on the project and reused during later reconciliation;
- intent history uses opaque keyset pagination with a supporting `(project_id, created_at, id)` index instead of relying on a fixed recent-row window;
- reconciliation and webhook workers renew leases per item and run with bounded concurrency, reducing duplicate work when a batch takes longer than expected;
- the daily Vercel maintenance endpoint is intentionally a small repair sweep so it stays within serverless execution limits;
- webhook retries honor bounded `Retry-After` guidance and have a configurable total-attempt budget;
- readiness checks the latest required schema migration, and liveness returns HTTP 503 if the database is unhealthy;
- browser and CLI calls carry request correlation IDs, and the CLI now includes readiness/operations/webhook/project-evidence diagnostics.


## Architecture

```text
CKB application / wallet
        |
        | build + sign with CCC
        v
@cellflow/ccc
        |
        | compute tx.hash() BEFORE broadcast
        | persist project intent + tx identity
        v
CellFlow API (Next.js / Vercel)
        |
        +-----------------------------+
        |                             |
        v                             v
PostgreSQL / Neon              Vercel Workflow
source of truth               durable reconcile loop
        |                             |
        +-------------+---------------+
                      |
                      v
                   CKB RPC
                      |
           pending / proposed /
           committed / rejected
                      |
                      v
          confirmation + assertions
                      |
          +-----------+-----------+
          |                       |
          v                       v
     evidence JSON          signed webhooks
```

CellFlow is **not** a wallet, signer, custody system, indexer, explorer, or smart contract platform.

## Status model

CellFlow deliberately does not collapse every concern into one state machine.

### Submission status

```text
NOT_SUBMITTED -> PREPARED -> BROADCASTING -> SUBMITTED
                                  |
                                  +-> SUBMISSION_UNKNOWN -> SUBMITTED
```

`SUBMISSION_UNKNOWN` means the network request ended ambiguously. It does **not** mean the transaction failed.

### Chain status

```text
UNOBSERVED | UNKNOWN | PENDING | PROPOSED | COMMITTED | REJECTED
```

### Workflow status

```text
IDLE | RECONCILING | WAITING_CONFIRMATIONS | CONFIRMED |
REORGED | CONFLICTED | EXPIRED
```

`COMMITTED` is an observed canonical-chain state. A project may require additional block depth before CellFlow reports `CONFIRMED`.

## Quick start

### Requirements

- Node.js 22+
- PostgreSQL (Neon works well)
- a CKB RPC endpoint

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env.local
```

Required values:

```env
DATABASE_URL=postgresql://...
CKB_NETWORK=testnet
CKB_RPC_URL=https://testnet.ckbapp.dev/rpc
CKB_RPC_FALLBACK_URLS=https://rpc-backup-1.example/rpc,https://rpc-backup-2.example/rpc
CKB_RPC_TIMEOUT_MS=10000
CKB_RPC_CIRCUIT_FAILURES=2
CKB_RPC_CIRCUIT_COOLDOWN_MS=30000
# Pin this to the expected chain genesis before production/mainnet rollout.
CKB_EXPECTED_GENESIS_HASH=
CELLFLOW_ENCRYPTION_KEY=<at-least-32-random-characters>
CELLFLOW_BOOTSTRAP_TOKEN=<different-bootstrap-token>
CELLFLOW_SETUP_ENABLED=true
# Flip to false immediately after initial provisioning in production.
CELLFLOW_RATE_LIMIT_PER_MINUTE=240
CELLFLOW_MAX_JSON_BODY_BYTES=262144
CRON_SECRET=<different-random-secret>
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEFAULT_CONFIRMATION_POLICY=depth:4
```

### 3. Migrate

```bash
npm run migrate
```

### 4. Run

```bash
npm run dev
```

Open `http://localhost:3000`. The collapsible first-deploy setup section accepts `CELLFLOW_BOOTSTRAP_TOKEN`; the server-only encryption key never enters the browser. The generated `cf_live_...` API key is shown once and kept only in page memory. Set `CELLFLOW_SETUP_ENABLED=false` after production provisioning.

## Production release gate

This repository is a **production candidate**, not a claim of externally proven mainnet safety. Before a public production/mainnet release:

1. generate and commit `package-lock.json` with the pinned package versions in this tree;
2. use `npm ci`, then run `npm test`, `npm run typecheck`, and `npm run build` in a network-enabled CI runner;
3. apply migrations through `004_operational_scalability.sql` to a staging database and exercise backup/restore;
4. pin `CKB_EXPECTED_GENESIS_HASH`, configure at least two independently operated production RPC endpoints, and keep setup disabled after bootstrap;
5. complete a real CKB testnet ambiguity/reorg/recovery exercise plus expected-Cell verification;
6. rotate bootstrap/API/webhook/encryption credentials and perform an external security review before mainnet.

The exported repository passes its deterministic offline suite, but the source environment used to prepare this ZIP did not have registry access, so a dependency-resolved `npm ci` / full workspace typecheck / Next.js production build could not be honestly re-run here.

## Web surfaces

CellFlow deliberately separates public explanation, live operations, simulation, and provisioning:

- `/` — public product/architecture overview. It contains no project credential input and no simulated operational metrics.
- `/console` — real operator surface for project connection, health/readiness, transaction intents, evidence, reconciliation, API keys, and webhooks. Demo state is never rendered on this route.
- `/demo` — isolated local-only SkillPass walkthrough. It requires no API key and performs no CKB writes.
- `/console/setup` — one-time bootstrap/provisioning surface. It is kept out of the day-to-day operator workspace and should be disabled server-side after initial provisioning.

This separation prevents simulated lifecycle state from being confused with live CKB/project data and keeps privileged setup controls away from normal operations. See `UI_PRODUCTION_UPGRADE.md` for the UI and regression coverage.

## API example

Create an intent:

```bash
curl -X POST http://localhost:3000/api/v1/intents \
  -H "Authorization: Bearer $CELLFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "intentId": "skillpass-transfer-1042",
    "metadata": {"passId":"SP-1042"},
    "expectedCells": []
  }'
```

Track a transaction hash:

```bash
curl -X POST http://localhost:3000/api/v1/intents/skillpass-transfer-1042/track \
  -H "Authorization: Bearer $CELLFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txHash":"0x...64-hex-chars..."}'
```

Query:

```bash
curl http://localhost:3000/api/v1/intents/skillpass-transfer-1042 \
  -H "Authorization: Bearer $CELLFLOW_API_KEY"
```

Evidence:

```bash
curl http://localhost:3000/api/v1/intents/skillpass-transfer-1042/evidence \
  -H "Authorization: Bearer $CELLFLOW_API_KEY"
```

## CCC integration: safe broadcast boundary

The key integration is `prepareTrackedTransaction`:

```ts
import { prepareTrackedTransaction, createCellFlow } from "@cellflow/ccc";

const flow = createCellFlow({
  endpoint: process.env.CELLFLOW_URL!,
  apiKey: process.env.CELLFLOW_API_KEY!,
});

const operation = await prepareTrackedTransaction({
  signer,
  transaction: tx,
  flow,
  intentId: "skillpass-transfer-1042",
  metadata: { passId: "SP-1042" },
  expectedCells: [
    {
      outputIndex: 0,
      lock: { args: bobLockArgs },
    },
  ],
});

// operation.txHash is already persisted in CellFlow here.
await operation.broadcast();
```

The helper uses CCC's deterministic `Transaction.hash()` before invoking CKB RPC. If broadcast times out, it records `SUBMISSION_UNKNOWN` and reconciliation checks the known hash before any application chooses to retry.

## Expected Cell assertions

V0.3 keeps the narrow, auditable expected-Cell assertion model introduced in V0.2. Use `mode: "created"` to prove the committed transaction created the Cell, or `mode: "live"` to additionally verify the current OutPoint with CKB `get_live_cell`:

```json
{
  "outputIndex": 0,
  "mode": "live",
  "capacity": "0x174876e800",
  "lock": {
    "codeHash": "0x...",
    "hashType": "type",
    "args": "0x..."
  },
  "type": null,
  "data": "0x"
}
```

Assertions must check at least one Cell field. If a transaction reaches its confirmation policy but the expected created/live Cell state does not match, the execution becomes `CONFLICTED`. If the transaction body or live-cell lookup is temporarily unavailable, the assertion stays `PENDING` and reconciliation continues instead of terminating early.

## Webhooks

Register:

```text
POST /api/v1/webhooks
```

The creation response contains a `whsec_...` secret once. Each endpoint has its own encrypted signing secret.

Headers:

```text
X-CellFlow-Signature: v1=<hex-hmac-sha256>
X-CellFlow-Timestamp: <unix-seconds>
X-CellFlow-Event-Id: <uuid>
X-CellFlow-Delivery-Id: <uuid>
```

Canonical signature input:

```text
v1.<timestamp>.<raw_body>
```

Webhook destinations are DNS-resolved immediately before delivery, private/link-local/reserved ranges are blocked, redirects are not followed, and the outgoing socket is pinned to the validated IP while preserving the original TLS SNI/Host. This closes the common DNS-rebinding gap in simple URL-only SSRF checks.

## Verification

The deterministic verification suite does not require a live PostgreSQL or CKB node:

```bash
npm run verify
```

Before a release, run the reproducibility gate and then the dependency-resolved checks in a clean runner:

```bash
npm run release:check
npm ci
npm run typecheck
npm run build
```

The 65-test suite covers pre-broadcast identity, ambiguous recovery, confirmation depth, canonical reorg evidence, stale-node regressions, transition invariants, tx-hash validation, created/live Cell assertions, leases/outbox behavior, RPC/readiness controls, scoped credentials, reviewer evidence, webhook recovery, browser secret handling and repository completeness.

## Vercel deployment

The Next.js app is wrapped with the Workflow SDK (`workflow/next`). A tracked/submitted transaction starts a durable workflow. PostgreSQL remains the source of truth; the workflow is execution machinery, not state ownership. `vercel.json` also runs `/api/internal/maintenance` periodically as a repair sweep for orphaned/due reconciliation and webhook delivery.

See `VERCEL_DEPLOYMENT.md`.

## Repository map

See `TREE.md`, `IMPLEMENTATION_STATUS.md`, `PRODUCTION_READINESS_V0.3.md`, and `FUNDING_AND_VALIDATION.md` for the implemented files, release gates, reviewer evidence and milestone strategy.


## Hardening history

See `V0.2_HARDENING.md` for the concurrency/canonical-chain foundation and `PRODUCTION_READINESS_V0.3.md` for the current credential, RPC, operations, evidence and release-control layer.
