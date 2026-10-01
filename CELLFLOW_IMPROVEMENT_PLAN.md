# CellFlow Improvement Plan

## 1. Product Positioning

### One-line purpose
**CellFlow is an application-neutral CKB transaction operations and recovery layer for safely resolving what happened after a signed transaction is prepared for broadcast.**

### Core question
> A signed CKB transaction was submitted, timed out, conflicted, replaced, or observed inconsistently. Can the application determine the canonical result without causing unsafe duplicate business actions?

### CellFlow must own
- business intent persistence;
- deterministic transaction identity before broadcast;
- multiple transaction attempts per intent;
- submit-time error classification;
- ambiguous submission handling;
- input conflict analysis;
- CKB transaction reconciliation;
- multi-RPC observation;
- confirmation/finality policy;
- reorg handling;
- expected output / live Cell verification;
- durable restart recovery;
- downstream settlement evidence and webhooks.

### CellFlow must not own
- wallet private keys;
- service entitlement semantics;
- warranty or application-specific state;
- bilateral application agreement;
- Fiber payment semantics;
- user identity / DID;
- application business rules.

---

## 2. Strong Invariant

Put this near the top of the README:

> **An uncertain submission outcome must never be treated as transaction failure without reconciling the known transaction attempt against canonical CKB state.**

A second invariant should be:

> **Business finalization is allowed only after the configured chain policy is satisfied and the expected Cell assertion succeeds.**

---

## 3. Make the Core Application-Neutral

### Core types

CellFlow core should use only generic infrastructure concepts:

```text
BusinessIntent
TransactionAttempt
InputRole
SubmissionStatus
ConflictStatus
ChainStatus
ConfirmationPolicy
ExpectedCellAssertion
RecoveryAction
EvidenceBundle
```

Avoid core concepts such as:

```text
Capability
SkillPass
entitlement
coverage
provider
warranty
EventMesh session
Fiber payment
```

SkillPass should remain an integration example, not a core dependency.

---

## 4. Recommended Flagship Scenario

### Scenario: ambiguous submission + contended input + rebuild

This is stronger than a simple successful transaction.

```text
Business intent #42
    |
    v
Attempt A signed
txHash A persisted
    |
    v
send_transaction
    |
    +--> lost response / timeout
    |
    v
reconcile txHash A
    |
    +--> found pending
    +--> found committed
    +--> rejected
    +--> absent
    +--> conflicting input observed
```

Then show a second branch:

```text
Attempt A
   |
   +--> application-state input spent
           |
           v
       wait contention grace
           |
           v
       refresh application state
           |
           v
       build Attempt B
           |
           v
       new txHash B
```

And another branch:

```text
Attempt A
   |
   +--> wallet funding input stale
           |
           v
       recollect wallet inputs
           |
           v
       resign
           |
           v
       Attempt B
```

This makes the project clearly different from wallets, RPC services, and ordinary retry logic.

---

## 5. Multi-Attempt Intent Model

Model one business intent with several CKB transaction attempts.

Example:

```text
Intent: purchase-42
  |
  +-- Attempt A
  |     txHash: 0xaaa
  |     result: MEMPOOL_CONTENDED
  |
  +-- Attempt B
  |     txHash: 0xbbb
  |     result: SUPERSEDED
  |
  +-- Attempt C
        txHash: 0xccc
        result: COMMITTED
        output assertion: VERIFIED
```

Recommended fields:

```text
intent_id
attempt_id
tx_hash
signed_payload_fingerprint
created_at
broadcast_started_at
submit_result
chain_result
superseded_by
rebuild_reason
input_snapshot
rpc_observation_provenance
```

---

## 6. Input-Role Analysis

Not every spent input means the same recovery action.

Classify each input:

```text
APPLICATION_STATE
WALLET_FUNDING
FEE_INPUT
DEPENDENCY
OTHER
```

### Recovery examples

#### Application state Cell spent
Likely action:
- identify canonical spender;
- wait a short contention grace period;
- refresh state;
- rebuild from the new application state.

#### Wallet funding Cell spent
Likely action:
- recollect funding inputs;
- preserve business intent;
- rebuild and request a new signature.

#### Unknown role
Fail closed and require explicit policy.

---

## 7. Submit-Time Error Classification

Do not send all errors into `SUBMISSION_UNKNOWN`.

Classify known errors immediately:

```text
ACCEPTED
SUBMISSION_UNKNOWN
INPUT_SPENT
MEMPOOL_CONTENDED
RBF_REJECTED
INVALID_TRANSACTION
IMMATURE_INPUT
SINCE_NOT_SATISFIED
RPC_UNAVAILABLE
```

Store:
- raw RPC code;
- raw RPC message;
- endpoint;
- timestamp;
- normalized classification.

---

## 8. RBF / Replacement Model

Track explicit relationships:

```text
Attempt A
  |
  +--> replaced by Attempt B
  |
  +--> superseded by Attempt C
```

Do not represent replacement as an unrelated new intent.

Add tests for:
- same-fee conflict;
- higher-fee replacement;
- replacement disappearing before commit;
- both hashes absent;
- old attempt committed after new attempt was prepared;
- one RPC seeing old attempt while another sees replacement.

---

## 9. Contention Grace Policy

Make contention grace explicit and configurable.

Example:

```text
contentionGraceMs: 30000
```

State machine:

```text
MEMPOOL_CONTENDED
     |
     v
WAIT_FOR_CANONICAL_MOVEMENT
     |
     +--> conflicting state advances -> rebuild from new state
     |
     +--> no movement by deadline -> re-query/rebuild under policy
```

Expose:
- start time;
- current conflicting outpoint;
- observed spender;
- grace deadline;
- recommended next action.

---

## 10. Multi-RPC Evidence

Do not use multi-RPC only as failover.

Treat each observation as evidence:

```json
{
  "endpoint": "rpc-a",
  "observedAt": "...",
  "transactionStatus": "pending",
  "tipNumber": "...",
  "tipHash": "..."
}
```

Then reconcile conflicting observations.

Useful statuses:

```text
CONSISTENT
RPC_LAG
CANONICAL_DIVERGENCE
INSUFFICIENT_EVIDENCE
```

Never silently average inconsistent RPC state.

---

## 11. Reorg Handling

Separate:

```text
COMMITTED
```

from:

```text
SETTLED
```

Example:

```text
COMMITTED
  |
  v
depth = 1
  |
  v
depth = 2
  |
  +--> reorg detected -> REORGED
  |
  v
depth = N
  |
  v
expected Cell assertion
  |
  v
SETTLED
```

Record:
- committing block;
- block hash;
- confirmation depth;
- canonical block check;
- reorg history.

---

## 12. Expected Cell Assertions

This is one of CellFlow's strongest differentiators.

Generic assertion schema:

```json
{
  "outputIndex": 0,
  "capacity": "...",
  "lock": {
    "codeHash": "...",
    "hashType": "...",
    "args": "..."
  },
  "type": {
    "codeHash": "...",
    "hashType": "...",
    "args": "..."
  },
  "dataHash": "...",
  "mustRemainLive": true
}
```

Support:
- exact output assertion;
- subset assertion;
- post-confirmation `get_live_cell`;
- expected consumed-input assertion;
- optional application-specific assertion adapter.

CellFlow should report:

```text
TRANSACTION_COMMITTED
but
APPLICATION_SETTLEMENT_ASSERTION_FAILED
```

instead of falsely declaring success.

---

## 13. CellFlow / SkillPass Boundary

SkillPass may use CellFlow, but CellFlow must not depend on SkillPass.

Correct dependency:

```text
SkillPass transfer builder
        |
        v
wallet signs
        |
        v
CellFlow
        |
        v
CKB
```

CellFlow sees:

```text
intent
signed transaction
inputs
expected output Cell
```

It does not need to know what a `Capability` means.

Put the existing SkillPass demo under:

```text
examples/skillpass/
```

---

## 14. CellFlow / EventMesh Boundary

EventMesh may use CellFlow for optional CKB commitment anchoring:

```text
EventMesh final commitment
        |
        v
CellFlow Anchor Adapter
        |
        v
CKB
```

CellFlow does not parse EventMesh transcripts or decide whether two operators agreed.

It only tracks the CKB transaction and expected anchor output.

---

## 15. API Plan

Suggested high-level API:

```text
POST /v1/intents
POST /v1/intents/:id/attempts
POST /v1/attempts/:id/broadcast
POST /v1/attempts/:id/reconcile
POST /v1/intents/:id/rebuild
GET  /v1/intents/:id
GET  /v1/intents/:id/evidence
```

Recommended status model:

```text
IntentStatus
  OPEN
  AWAITING_SIGNATURE
  ACTIVE
  SETTLED
  FAILED_FINAL
  CANCELLED
```

Attempt status remains separate.

Do not collapse everything into a single transaction status.

---

## 16. Recovery Decision Object

Expose a machine-readable next action:

```json
{
  "classification": "INPUT_SPENT",
  "inputRole": "WALLET_FUNDING",
  "action": "RECOLLECT_AND_RESIGN",
  "safeToReuseBusinessIntent": true,
  "safeToRebroadcastSameBytes": false,
  "requiresNewSignature": true
}
```

This makes CellFlow more useful to downstream apps than a simple explorer/status API.

---

## 17. Evidence Package

Publish evidence from real Testnet scenarios:

```text
evidence/
  ambiguous-submit/
  contention/
  wallet-stale-input/
  higher-fee-rbf/
  restart-recovery/
  multi-rpc/
  reorg/
```

Each scenario should contain:

```text
intent.json
attempts.json
rpc-observations.json
transaction.json
block-evidence.json
expected-cell.json
recovery-decisions.json
summary.json
reproduce.md
```

---

## 18. Real Validation Scenarios

Minimum Testnet suite:

### Scenario A — ambiguous response
- tx hash persisted before broadcast;
- broadcast response intentionally lost;
- tx recovered by hash;
- commit confirmed;
- output Cell verified.

### Scenario B — application-state contention
- two clients spend the same state Cell;
- losing transaction classified correctly;
- contention grace applied;
- new state observed;
- rebuild creates a new attempt.

### Scenario C — stale wallet funding input
- wallet funding input becomes dead;
- CellFlow distinguishes it from app-state contention;
- inputs recollected;
- new signature requested.

### Scenario D — higher-fee replacement
- attempt A enters pool;
- attempt B replaces/supersedes A;
- intent remains one logical operation;
- correct final attempt selected.

### Scenario E — server restart
- process dies after broadcast;
- no in-memory state required;
- restart resumes from durable intent/attempt state.

### Scenario F — RPC disagreement
- endpoints return different observations;
- evidence provenance retained;
- settlement waits for configured trust/canonical policy.

### Scenario G — reorg
- committed transaction loses canonical block;
- state re-enters reconciliation;
- application is not prematurely finalized.

---

## 19. UI Plan

### Landing message
> **Recover safely when a CKB transaction result is uncertain.**

### Demo selector

```text
Lost RPC response
Input conflict
Wallet stale input
Higher-fee replacement
Server restart
RPC disagreement
Reorg
Expected Cell mismatch
```

### Operator view
Show separate cards for:

```text
Business Intent
Transaction Attempts
Input Conflicts
Chain Observation
Confirmation Policy
Expected Cell Assertion
Recommended Recovery Action
Evidence
```

Avoid SkillPass-specific labels in the production console.

---

## 20. Repository Structure

```text
src/
  intents/
  attempts/
  submit/
  conflicts/
  reconciler/
  rpc-observation/
  confirmation/
  reorg/
  assertions/
  evidence/
  webhooks/

examples/
  skillpass/
  crowdcell/
  generic-cell-update/

tests/
  unit/
  lifecycle/
  contention/
  rbf/
  reorg/
  rpc/
  restart/
  testnet/

evidence/
docs/
  architecture.md
  recovery-model.md
  conflict-model.md
  finality-model.md
```

---

## 21. Milestone Plan

### P0 — Core boundary
- Remove SkillPass-specific semantics from core.
- Formalize multi-attempt intent model.
- Formalize input-role recovery.
- Make normalized submit-time error classification explicit.
- Publish recovery decision schema.

### P0 — Evidence
- Run ambiguous-response Testnet scenario.
- Run contention scenario.
- Run stale-wallet-input scenario.
- Export machine-readable evidence.

### P1 — Advanced transaction behavior
- higher-fee RBF;
- multi-RPC evidence;
- restart recovery;
- reorg validation;
- confirmation policy validation.

### P1 — Integration ergonomics
- TypeScript client package;
- CCC adapter;
- simple application callback hooks;
- CellFlow anchor adapter for EventMesh;
- generic expected-Cell builder helpers.

### P2 — Production hardening
- external security review;
- SLO/observability;
- retention policy;
- evidence signing;
- hosted-service vs library boundary.

---

## 22. Final Scope Test

Before adding a feature, ask:

> Does this feature help an application recover and finalize an uncertain CKB transaction lifecycle?

If **yes**, it may belong in CellFlow.

If it primarily:
- determines service-right ownership -> SkillPass;
- tracks quota/service history -> SkillPass Care;
- proves bilateral business agreement -> EventMesh;
- handles Fiber payment routing -> Fiber;
- signs transactions for users -> wallet.

That boundary keeps CellFlow useful and application-neutral.
