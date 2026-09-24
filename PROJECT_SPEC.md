# CellFlow Project Specification

## Problem statement

Modern CKB applications can construct, sign, and send transactions with CCC, but each application still tends to implement its own logic for durable business intents, transaction-status polling, ambiguous-submit recovery, process restart recovery, conflict detection, webhook delivery, and post-commit business reconciliation. CellFlow turns that repeated application glue into a reusable CKB-native layer.

## Users

Primary users:

- CKBuilder teams deploying dApps on Vercel or similar serverless hosts;
- TypeScript/Next.js applications using CCC;
- backend APIs that submit or track signed CKB transactions;
- teams that need reproducible evidence for testnet/production readiness.

Secondary users:

- grant reviewers validating project milestones;
- infrastructure teams troubleshooting application-level transaction failures;
- SDK maintainers looking for real application compatibility tests.

## Core entities

### Project
A tenant/application integrating CellFlow. Contains API credentials, network configuration, webhook settings, and rate policies.

### Intent
Application-defined idempotent business operation such as `transfer-pass-1042`. An intent may be linked to one transaction in V1. Future versions may support DAGs/multiple transactions.

### Transaction execution
The CKB transaction associated with an intent. Stores tx hash, network, last known chain state, error class, timestamps, retry/reconciliation counters, and optional signed transaction payload if explicitly configured.

### State event
Append-only history item describing an observed or derived lifecycle transition.

### Webhook delivery
Record of a callback attempt, status code, signature version, next retry time, and final disposition.

### Evidence artifact
Machine-readable summary that proves lifecycle events and final observed outcome.

## Required invariants

1. `(project_id, intent_id)` is unique.
2. State transitions must follow an explicit transition table.
3. A terminal state cannot silently return to a non-terminal state; exceptional recovery must create an explicit event.
4. Webhook delivery must be at-least-once and documented as such.
5. API idempotency must not depend on in-memory cache.
6. Private keys must never be stored.
7. RPC timeout is not equal to transaction failure.
8. Chain observation timestamps and server timestamps are distinct fields.
9. Evidence export must be deterministic for the same stored execution record.
10. Every mutation is auditable.

## V1 functional requirements

- Create project.
- Create/register intent.
- Attach tx hash.
- Optional submit signed transaction path.
- Query intent state.
- List recent intents.
- Trigger/continue reconciliation.
- Record lifecycle event history.
- Deliver signed webhook on state changes.
- Export JSON evidence.
- Dashboard for operational visibility.

## API sketch

```text
POST   /api/v1/intents
GET    /api/v1/intents/:intentId
POST   /api/v1/intents/:intentId/track
POST   /api/v1/intents/:intentId/submit
POST   /api/v1/intents/:intentId/reconcile
GET    /api/v1/intents/:intentId/evidence
GET    /api/v1/intents?status=pending
POST   /api/v1/projects/:projectId/webhooks/test
```

Use versioned APIs from day one.

## State mapping

CKB RPC transaction states should be normalized into CellFlow domain states without throwing away source information. Store the raw status response for diagnostics where safe.

Example normalization:

```text
unknown/unavailable -> UNKNOWN
pending             -> PENDING
proposed            -> PROPOSED
committed           -> COMMITTED
rejected            -> REJECTED
```

`RECONCILING`, `CONFLICTED`, and `EXPIRED` are CellFlow application states derived from workflow behavior, not direct node states.

## Quality requirements

- TypeScript strict mode.
- Schema validation at every external boundary.
- No `any` in public package APIs.
- Database migrations checked into source control.
- Unit coverage for all state transitions.
- Integration tests against a controllable testnet/devnet fixture when feasible.
- Serverless restart safety tests.
- Structured logging with correlation IDs.
- Security documentation before public pilot.

## V1 completion definition

V1 is complete only when the same release is used by SkillPass and one independent project and both can demonstrate normal commit, duplicate request protection, ambiguous submit reconciliation, and restart recovery.
