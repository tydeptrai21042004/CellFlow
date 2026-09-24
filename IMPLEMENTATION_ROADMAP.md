# Implementation Roadmap

## Phase 0 — Validation before implementation

Goal: prove the problem is real and avoid building overlapping infrastructure.

Tasks:

- Ask CCC/CKBuilder maintainers whether a CCC-native durable transaction manager already exists.
- Collect 3 examples from existing CKB apps showing custom transaction lifecycle/polling/recovery code.
- Write a one-page problem statement with exact failure cases.
- Define SkillPass operation that will be migrated first.

Exit criteria:

- At least two builders confirm they currently own custom post-submit tracking/recovery logic, or maintainers confirm no reusable equivalent exists.

## Phase 1 — Domain core

Build `packages/core` and `docs/state-machine`.

Deliverables:

- states and transitions;
- domain errors;
- normalized CKB status model;
- intent model;
- evidence model;
- deterministic transition tests.

Exit criteria:

- 100% transition-table unit coverage;
- no networking/database dependency in core.

## Phase 2 — Persistence and API

Build `packages/db` and `apps/api`.

Deliverables:

- PostgreSQL schema;
- migrations;
- project/API-key model;
- intent CRUD;
- state event append;
- REST API;
- OpenAPI document.

Exit criteria:

- duplicate `(project_id, intent_id)` requests return the same logical intent;
- API works after process restart.

## Phase 3 — Reconciliation workflow

Build `workflows/reconcile`.

Deliverables:

- RPC adapter;
- transaction-state mapping;
- retry/backoff policy;
- unknown-state handling;
- workflow resume after redeploy/restart.

Exit criteria:

- failure tests for RPC timeout and temporary RPC outage;
- workflow eventually reaches terminal state when RPC recovers.

## Phase 4 — CCC SDK

Build `packages/ccc`.

Deliverables:

- typed client;
- `track()`;
- optional `submit()` when signed transaction serialization is stable;
- polling/wait helper for local developer convenience;
- examples for Next.js API routes.

Exit criteria:

- package can be installed from a clean example and track a real testnet transaction.

## Phase 5 — Dashboard and webhooks

Build `apps/web` and `packages/webhooks`.

Deliverables:

- project overview;
- intent table;
- intent timeline;
- retry/reconciliation visibility;
- webhook configuration and signing;
- test webhook action.

Exit criteria:

- dashboard contains no correctness-critical state that isn't persisted;
- webhook signature example has automated verification.

## Phase 6 — Failure evidence

Build `tests/failure` and `docs/evidence`.

Mandatory scenarios:

1. normal commit;
2. duplicate intent creation;
3. RPC timeout during reconciliation;
4. simulated ambiguous submission path;
5. process/redeploy restart;
6. rejected transaction;
7. stale/temporarily unavailable RPC response.

Exit criteria:

- CI creates machine-readable evidence artifacts for each scenario.

## Phase 7 — SkillPass pilot

Integrate one real lifecycle such as pass transfer.

Exit criteria:

- SkillPass no longer owns bespoke lifecycle state for that operation;
- public demo and evidence artifact available.

## Phase 8 — Independent pilot

Choose one external project with simple testnet transactions.

Exit criteria:

- external maintainer confirms integration usefulness;
- at least one issue/PR/testimonial can be referenced in funding application.

## Phase 9 — Vercel polish

Deliver one-click deployment, Neon provisioning instructions, environment validation, and deployment health checks.

## Phase 10 — Funding proposal

Only after adoption evidence. Prepare Spark-sized scope first; reserve broader integrations and advanced Cell assertions for DAO follow-on.
