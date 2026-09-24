# CellFlow — CKB Transaction Operations Layer

## 1. Project purpose

CellFlow is an open-source, CCC-native transaction operations layer for production CKB applications. It sits between an application and CKB infrastructure after transaction construction/signing and is responsible for durable execution state, idempotent business intents, transaction reconciliation, restart recovery, CKB-specific transaction lifecycle tracking, webhook delivery, and later expected-Cell verification.

CellFlow is **not** a wallet, indexer, explorer, custody service, payment gateway, smart contract, or replacement for CCC. CCC remains the transaction/wallet SDK. CellFlow begins where applications normally start writing ad-hoc persistence and polling logic around `sendTransaction`.

The first public proof should use SkillPass as consumer #1 and at least one independently maintained CKBuilder application as consumer #2.

## 2. Product promise

A developer should be able to do the following:

```ts
const flow = createCellFlow({
  endpoint: process.env.CELLFLOW_URL!,
  apiKey: process.env.CELLFLOW_API_KEY!,
});

await flow.track({
  intentId: "skillpass-transfer-1042",
  txHash,
  metadata: { passId: "SP-1042" },
});
```

CellFlow then maintains a durable lifecycle such as:

```text
CREATED -> SUBMITTED -> PENDING -> PROPOSED -> COMMITTED
                         |             |
                         +-> UNKNOWN <-+
                               |
                         RECONCILING
```

Exceptional terminal states include `REJECTED`, `CONFLICTED`, and `EXPIRED`.

The API must never imply blockchain-level exactly-once execution. Instead, it offers **idempotent application intents**, deterministic transaction identity where possible, durable persistence, and reconciliation against CKB.

## 3. V1 scope

V1 is deliberately narrow. It must include:

1. `@cellflow/core` domain model and state machine.
2. `@cellflow/ccc` TypeScript integration package.
3. Vercel-hosted Next.js API and dashboard.
4. Neon/PostgreSQL persistence.
5. Durable reconciliation workflow compatible with Vercel Workflows.
6. `get_transaction`-based state reconciliation.
7. Intent idempotency using `(project_id, intent_id)` uniqueness.
8. Structured statuses: created, submitted, pending, proposed, committed, rejected, unknown, reconciling, conflicted, expired.
9. Signed webhook delivery with retry bookkeeping.
10. SkillPass reference integration.
11. One independent external CKBuilder integration.
12. Reproducible failure scenarios and evidence artifacts.
13. One-click or near-one-click Vercel deployment.

## 4. Explicit non-goals for V1

Do **not** add the following unless the V1 acceptance criteria are already satisfied:

- Fiber payment logic.
- RGB++ cross-chain orchestration.
- AI-agent functionality.
- Custody or signing keys.
- General-purpose blockchain support.
- Own CKB indexer.
- Explorer features.
- Automatic fee bumping/replacement logic.
- Mobile SDKs.
- Smart contracts.
- Complex notification channels.
- Billing or SaaS monetization.
- Multi-region worker orchestration.

These are possible future integrations, not V1 requirements.

## 5. Security boundary

CellFlow must never require or store:

- private keys;
- seed phrases;
- wallet credentials;
- signing capability;
- user recovery secrets.

Accepted inputs are signed transactions, transaction hashes, public metadata, expected state assertions, and project-level API credentials.

Every external callback must be HMAC-signed. Secrets must be encrypted/managed through deployment environment variables. Logs must redact credentials automatically.

## 6. Deployment target

The reference deployment is Vercel-first:

```text
GitHub repository
      |
      v
Vercel Next.js app
      |
      +--> API routes
      +--> dashboard
      +--> durable workflows
      +--> scheduled maintenance/reconciliation
      |
      +--> Neon PostgreSQL
      |
      +--> CKB RPC provider
```

The demo should require only:

```env
DATABASE_URL=
CKB_NETWORK=testnet
CKB_RPC_URL=
CELLFLOW_MASTER_SECRET=
WEBHOOK_SIGNING_SECRET=
NEXT_PUBLIC_APP_URL=
```

No Docker, Redis, VPS, Kubernetes, locally running CKB node, or permanent background daemon should be required for the hosted MVP.

## 7. Repository structure

```text
cellflow-project-blueprint/
├── README.md
├── PROJECT_SPEC.md
├── IMPLEMENTATION_ROADMAP.md
├── VERCEL_DEPLOYMENT.md
├── SECURITY_MODEL.md
├── FUNDING_AND_VALIDATION.md
├── CONTRIBUTING_PLAN.md
├── docs/
│   ├── README.md
│   ├── architecture/
│   ├── state-machine/
│   ├── api/
│   ├── data-model/
│   ├── evidence/
│   └── adoption/
├── apps/
│   ├── README.md
│   ├── web/
│   └── api/
├── packages/
│   ├── README.md
│   ├── core/
│   ├── ccc/
│   ├── db/
│   ├── webhooks/
│   └── assertions/
├── workflows/
│   ├── README.md
│   ├── reconcile/
│   └── webhook-delivery/
├── tests/
│   ├── README.md
│   ├── unit/
│   ├── integration/
│   ├── failure/
│   └── e2e/
├── examples/
│   ├── README.md
│   ├── skillpass/
│   └── external-pilot/
├── deploy/
│   ├── README.md
│   └── vercel/
├── scripts/
│   └── README.md
└── funding/
    ├── README.md
    ├── spark/
    └── dao/
```

Every folder contains its own `README.md` with implementation instructions.

## 8. Engineering principles

### 8.1 Durable before convenient
Persist the execution record before beginning a network operation whenever the integration path allows it.

### 8.2 Reconcile rather than guess
When an RPC request times out, do not immediately assume submission failed. Determine the deterministic transaction hash, query known infrastructure, and resume from observed chain state.

### 8.3 CKB-native semantics
Model CKB transaction lifecycle and Cells explicitly. Avoid translating the system into Ethereum nonce/gas abstractions.

### 8.4 Evidence-first delivery
Each milestone must have an automated verification command and machine-readable evidence. A grant reviewer should be able to validate a claim without understanding the entire source tree.

### 8.5 Vercel-safe design
Avoid correctness that depends on process memory, singleton workers, or long-lived Node processes. Assume serverless processes can stop between requests.

### 8.6 Minimal trust
CellFlow observes, stores, reconciles, and reports. It does not sign user transactions.

## 9. Initial success metrics

Before a Community Fund DAO proposal, target:

- 2 independently maintained applications integrated;
- >= 500 tracked testnet operations;
- reproducible successful recovery from RPC timeout after submit;
- reproducible successful recovery after application/Vercel restart;
- zero duplicate business intents in the idempotency test suite;
- webhook signature verification example published;
- >= 5 failure/recovery scenarios included in CI;
- public dashboard/demo available;
- package install instructions executable from a clean repository;
- at least one external developer testimonial or issue confirming the problem.

## 10. Recommended build order

Do not build folders in alphabetical order. Follow this sequence:

1. `docs/state-machine`
2. `packages/core`
3. `packages/db`
4. `apps/api`
5. `workflows/reconcile`
6. `packages/ccc`
7. `apps/web`
8. `packages/webhooks`
9. `tests/failure`
10. `examples/skillpass`
11. `examples/external-pilot`
12. `docs/evidence`
13. `deploy/vercel`
14. funding material

See `IMPLEMENTATION_ROADMAP.md` for milestone-level acceptance criteria.
