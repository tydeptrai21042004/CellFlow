# CellFlow

**CKB-native durable transaction operations and recovery for TypeScript applications.**

CellFlow sits after transaction construction/signing and before application business finalization. It does not hold keys. It persists application intent, tracks CKB transaction state, survives serverless restarts, handles ambiguous broadcast outcomes, waits for configurable confirmation depth, detects reorg evidence, verifies expected output Cells, and emits signed webhooks.

## Implemented MVP

This repository now contains a runnable implementation rather than only the original blueprint:

- strict TypeScript domain/state-machine package;
- PostgreSQL/Neon schema and repository layer;
- database-enforced `(project_id, intent_id)` idempotency;
- separated **submission**, **chain**, and **workflow** status axes;
- CKB JSON-RPC reconciliation (`get_transaction`, `get_header`, `get_tip_header`);
- configurable confirmation policy (`committed` or `depth:N`);
- explicit reorg state rather than treating `COMMITTED` as permanently terminal;
- Vercel Workflow SDK durable reconciliation loop;
- Vercel Cron repair sweep as a secondary safety mechanism;
- CCC integration that calculates `tx.hash()` and persists it **before broadcast**;
- ambiguous-submit handling without automatic duplicate rebroadcast;
- expected-Cell assertions for output index/capacity/lock/type/data;
- signed per-endpoint webhooks, retries, encrypted secrets and DNS-pinned SSRF protection;
- project/API-key bootstrap flow;
- operational dashboard;
- deterministic JSON evidence endpoint;
- unit verification for the critical state machine.

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
CELLFLOW_MASTER_SECRET=<at-least-32-random-characters>
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

Open `http://localhost:3000`. The setup panel accepts `CELLFLOW_MASTER_SECRET`, creates a project, and displays the generated `cf_live_...` API key once. Only its SHA-256 hash is stored.

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

V1 supports narrow, auditable assertions:

```json
{
  "outputIndex": 0,
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

If a transaction reaches confirmation policy but its expected Cells do not match, the execution becomes `CONFLICTED` and the evidence record contains the failed checks.

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

Core state-machine tests do not require a database:

```bash
npm test
```

Full CI after dependency installation runs:

```bash
npm run typecheck
npm run build
```

The critical tests cover:

- pre-broadcast submission identity;
- ambiguous submission recovery;
- confirmation depth;
- explicit reorg detection;
- UNKNOWN-after-commit without false reorg classification;
- transaction-hash validation.

## Vercel deployment

The Next.js app is wrapped with the Workflow SDK (`workflow/next`). A tracked/submitted transaction starts a durable workflow. PostgreSQL remains the source of truth; the workflow is execution machinery, not state ownership. `vercel.json` also runs `/api/internal/maintenance` periodically as a repair sweep for orphaned/due reconciliation and webhook delivery.

See `VERCEL_DEPLOYMENT.md`.

## Repository map

See `TREE.md` and `IMPLEMENTATION_STATUS.md` for the implemented files and remaining production-hardening items.
