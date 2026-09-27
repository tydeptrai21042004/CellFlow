# Funding Must-Fix Final Checklist — CellFlow

> **Funding role:** SECOND / LATER standalone funding candidate.
>
> **Rule:** Do not request a separate CellFlow grant until the project has real CKB Testnet recovery evidence **and** at least one independent application using it.
>
> **Core claim to prove:** A CKB application can persist transaction intent and identity before broadcast, survive ambiguous submission/restarts/RPC failure, reconcile against canonical chain state, verify the expected live Cell, and finalize the business operation without unsafe duplicate execution.

---

# P0 — FUNDING BLOCKERS

## P0.1 — Publish one REAL ambiguous-broadcast Testnet recovery trace

The current demo is intentionally simulated. The funding proof must use a real signed/broadcast CKB Testnet transaction.

Required lifecycle:

```text
create business intent
        ↓
persist intent
        ↓
build/sign transaction
        ↓
compute tx hash
        ↓
persist tx hash BEFORE broadcast
        ↓
broadcast
        ↓
intentionally lose / obscure RPC response
        ↓
SUBMISSION_UNKNOWN
        ↓
restart / resume
        ↓
reconcile by known tx hash
        ↓
observe canonical COMMITTED state
        ↓
wait confirmation policy
        ↓
verify exact expected Cell
        ↓
verify live Cell when required
        ↓
business operation finalized once
```

Checklist:

- [ ] Use CKB Testnet, not local-only simulated chain state.
- [ ] Persist an intent before broadcast.
- [ ] Compute deterministic `txHash` before broadcast.
- [ ] Persist `txHash` before network side effect.
- [ ] Inject an intentionally ambiguous broadcast result.
- [ ] Record why the client cannot safely classify the submission as failed.
- [ ] Persist `SUBMISSION_UNKNOWN`.
- [ ] Reconcile using the already-known tx hash.
- [ ] Observe pending/proposed/committed transitions when available.
- [ ] Record confirmation depth.
- [ ] Verify the expected created Cell.
- [ ] Verify current live Cell when the application requires liveness.
- [ ] Finalize the business operation only after assertion success.
- [ ] Prove no duplicate business side effect occurred.
- [ ] Export per-intent evidence JSON.
- [ ] Export project evidence snapshot/hash.
- [ ] Publish exact transaction hashes/outpoints.

### Funding gate

- [ ] The test remains successful even though the original broadcast response is intentionally unusable.

---

## P0.2 — Prove restart/redeploy recovery

CellFlow's value is durability across process/serverless boundaries.

- [ ] Start a real Testnet operation.
- [ ] Persist intent + tx identity.
- [ ] Force the worker/API process to stop after broadcast or during reconciliation.
- [ ] Restart/redeploy the service.
- [ ] Recover the same operation from PostgreSQL.
- [ ] Resume reconciliation.
- [ ] Reach the correct final chain state.
- [ ] Verify expected Cell.
- [ ] Prove no duplicate business finalization.
- [ ] Retain logs/evidence before and after restart.
- [ ] Add an automated failure-injection script.

### Funding gate

- [ ] In-memory continuity is not required for correctness.

---

## P0.3 — Prove multi-RPC failover with network identity safety

The code has circuit breaking/fallback. Produce real evidence.

- [ ] Configure at least two independent CKB Testnet RPC endpoints.
- [ ] Pin expected network/genesis identity.
- [ ] Demonstrate both endpoints match the intended Testnet network.
- [ ] Start a reconciliation operation.
- [ ] Intentionally break/disable primary RPC.
- [ ] Trigger fallback.
- [ ] Continue reconciliation through secondary RPC.
- [ ] Record circuit-breaker activation.
- [ ] Record fallback endpoint use.
- [ ] Confirm canonical result is unchanged.
- [ ] Confirm an endpoint with wrong network identity is rejected.
- [ ] Retain machine-readable failover evidence.

---

## P0.4 — Commit lockfile and make release reproducible

The current repo explicitly marks missing `package-lock.json` as a release blocker.

- [ ] Generate root `package-lock.json`.
- [ ] Commit it.
- [ ] `npm ci` succeeds on a clean clone.
- [ ] Remove "missing lockfile" release blockers from `RELEASE_STATUS.json`.
- [ ] `npm run release:check` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run migrate` works from a clean database.
- [ ] exact Node version is documented/pinned.
- [ ] direct and transitive dependencies are reproducible.

---

## P0.5 — Add public GitHub Actions CI

The uploaded repo has no `.github/workflows`.

Create a release-quality CI workflow.

- [ ] `.github/workflows/ci.yml`
- [ ] clean `npm ci`
- [ ] PostgreSQL service
- [ ] run migrations
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:db-integration`
- [ ] `npm run build`
- [ ] `npm run release:check`
- [ ] verify tree/release report
- [ ] security/dependency scan
- [ ] publish test/evidence artifacts where useful
- [ ] README CI badge

### Funding gate

- [ ] Funding release tag has a fully green public CI run.

---

## P0.6 — Prove PostgreSQL concurrency/idempotency under real failure

CellFlow's durable intent model is central to the product.

- [ ] Run DB integration/concurrency tests in CI.
- [ ] Prove one project/idempotency key maps to one intended operation.
- [ ] Race duplicate create/submit requests.
- [ ] Prove duplicate business execution is collapsed.
- [ ] Prove leases prevent two workers from finalizing the same operation.
- [ ] Prove expired leases can be safely recovered.
- [ ] Prove atomic operation state + event + webhook-outbox writes.
- [ ] Prove restart does not reset state.
- [ ] Prove requeue/retry does not duplicate downstream events.
- [ ] Publish concurrency test results.

---

## P0.7 — Demonstrate expected-Cell verification as a real settlement boundary

CellFlow should prove why observing `COMMITTED` alone is not enough for the application.

- [ ] Define a real expected output Cell.
- [ ] Check output index.
- [ ] Check capacity.
- [ ] Check lock.
- [ ] Check type.
- [ ] Check data.
- [ ] Verify live Cell when required.
- [ ] Create one negative test where transaction commits but expected assertion fails.
- [ ] Ensure business finalization does not occur on assertion failure.
- [ ] Export assertion evidence.
- [ ] Explain this boundary in the README with one concrete example.

---

## P0.8 — Add one independent application integration

This is the most important product proof after the real failure trace.

SkillPass is a good internal example, but a standalone infrastructure grant should show another application can adopt the model.

- [ ] Choose an external CKB project/application.
- [ ] Integrate CellFlow around its existing signing/broadcast path.
- [ ] Do not require CellFlow to hold user private keys.
- [ ] Preserve the application's existing business database.
- [ ] Use the same durable intent/reconciliation model.
- [ ] Define an application-specific expected Cell assertion.
- [ ] Run at least one real Testnet operation.
- [ ] Record integration time.
- [ ] Record code changes required in the external app.
- [ ] Record API/documentation friction.
- [ ] Obtain public confirmation from the external maintainer.
- [ ] Link the external repo/PR from the CellFlow funding evidence.

### Funding gate

- [ ] At least one application not maintained solely as a CellFlow demo uses CellFlow successfully.

---

# P1 — STRONGLY IMPROVE THE FUNDING CASE

## P1.1 — Create a lightweight integration package/SDK boundary

The project currently exposes service/API infrastructure. Make adoption minimal.

- [ ] Decide whether the funded reusable boundary is REST, TypeScript SDK, or both.
- [ ] If TypeScript SDK: publish one small package.
- [ ] Keep wallet/signing outside CellFlow.
- [ ] Provide a wrapper around:
  - prepare/register intent;
  - persist tx identity;
  - report/broadcast state;
  - reconcile;
  - fetch evidence.
- [ ] Provide a CCC integration example.
- [ ] Provide one `<30 minute` integration guide.
- [ ] Add external-package consumer test.
- [ ] Define compatibility/version policy.

---

## P1.2 — Publish a structured real Testnet evidence bundle

Create:

- [ ] `evidence/testnet/README.md`
- [ ] `evidence/testnet/manifest.json`
- [ ] ambiguous broadcast trace
- [ ] restart recovery trace
- [ ] primary RPC outage/failover trace
- [ ] expected/live Cell verification trace
- [ ] idempotency/duplicate-attempt trace
- [ ] webhook retry trace
- [ ] source commit
- [ ] deployment version
- [ ] transaction hashes
- [ ] relevant outpoints
- [ ] evidence export hashes
- [ ] exact reproduction/failure-injection commands

---

## P1.3 — Run a real operational window

A one-off demo proves mechanism; an operational window proves the system remains usable.

- [ ] Run CellFlow on Testnet for at least several weeks before the final funding ask.
- [ ] Prefer 30 days for a mature standalone proposal.
- [ ] Track total operations.
- [ ] Track confirmed operations.
- [ ] Track `SUBMISSION_UNKNOWN`.
- [ ] Track percentage recovered through reconciliation.
- [ ] Track RPC failures.
- [ ] Track fallback activations.
- [ ] Track reorg/conflict/rejection events.
- [ ] Track reconciliation backlog.
- [ ] Track webhook delivered/retried/failed counts.
- [ ] Track manual intervention count.
- [ ] Track median/p95 observation time.
- [ ] Publish anonymized metrics snapshot.
- [ ] Do not claim "zero loss" from a small sample.

---

## P1.4 — External security review before production/Mainnet claims

A formal audit is not required for the first Testnet proof, but a standalone funded infrastructure project benefits from external review.

- [ ] Review API key scoping/rotation.
- [ ] Review webhook signing/replay.
- [ ] Review SSRF/DNS rebinding protections.
- [ ] Review RPC trust/network pinning.
- [ ] Review idempotency key semantics.
- [ ] Review lease/retry semantics.
- [ ] Review reorg handling.
- [ ] Review evidence integrity.
- [ ] Review secret handling.
- [ ] Review project isolation/multi-tenancy.
- [ ] Publish findings/remediation.
- [ ] Do not call the project "audited" without an actual audit.

---

## P1.5 — Backup/restore and disaster recovery proof

- [ ] Automated PostgreSQL backup procedure documented.
- [ ] Restore procedure documented.
- [ ] Perform staging backup.
- [ ] Destroy/replace staging DB.
- [ ] Restore.
- [ ] Reconciliation resumes from restored state.
- [ ] No operation identity is regenerated incorrectly.
- [ ] Evidence/audit records remain consistent.
- [ ] Record RPO/RTO observed during the exercise.

---

## P1.6 — Clarify hosted-service vs library boundary

The funding proposal should not look like a generic SaaS build.

- [ ] State the open-source reusable core.
- [ ] State which components are optional hosted operations.
- [ ] State data retained by hosted service.
- [ ] State what the consuming application continues to own.
- [ ] State that CellFlow does not hold signing keys.
- [ ] State that CellFlow does not replace CCC.
- [ ] State that CellFlow does not replace RPC/indexer infrastructure.
- [ ] State that CellFlow does not replace application business DB.
- [ ] Provide self-host instructions if feasible.

---

# P2 — STANDALONE GRANT PREPARATION

Only prepare this after the P0 proof is complete.

## P2.1 — Keep the grant scope narrow

Fund:

- [ ] reusable transaction-operations/recovery tooling;
- [ ] real Testnet failure validation;
- [ ] integration ergonomics;
- [ ] external adopter;
- [ ] operational/security hardening;
- [ ] reproducibility and documentation.

Do not bundle:

- [ ] wallet product;
- [ ] custody/key management;
- [ ] Fiber payment system;
- [ ] marketplace;
- [ ] generic analytics platform;
- [ ] mobile app;
- [ ] unrelated blockchain support;
- [ ] Mainnet guarantee.

---

## P2.2 — Objective milestone shape

### Milestone 1 — Reproducible production candidate
- [ ] lockfile
- [ ] clean CI
- [ ] DB migration/recovery
- [ ] two-RPC Testnet configuration
- [ ] release tag
- [ ] runbook/threat model

### Milestone 2 — Real recovery evidence
- [ ] ambiguous broadcast
- [ ] restart recovery
- [ ] RPC failover
- [ ] expected/live Cell assertion
- [ ] webhook retry evidence
- [ ] machine-readable evidence bundle

### Milestone 3 — External adoption
- [ ] independent CKB application integration
- [ ] public maintainer confirmation
- [ ] integration report
- [ ] operational metrics window
- [ ] SDK/API compatibility policy

### Milestone 4 — Security/ecosystem hardening
- [ ] external review
- [ ] remediation
- [ ] backup/restore drill
- [ ] signed/versioned release
- [ ] final reproducibility report

---

## P2.3 — Claims discipline

Never claim:

- [ ] "exactly-once blockchain execution"
- [ ] "guaranteed transaction success"
- [ ] "zero loss"
- [ ] "works with every CKB app"
- [ ] "production-ready" only because unit tests pass
- [ ] "audited" without audit
- [ ] "replaces CCC"
- [ ] "replaces indexers/RPC"

Prefer measurable claims:

- [ ] known tx identity persisted before broadcast;
- [ ] ambiguous response reconciled by tx hash;
- [ ] durable restart recovery demonstrated;
- [ ] expected Cell assertion verified;
- [ ] duplicate application finalization prevented in tested scenarios;
- [ ] real Testnet artifacts published.

---

# FINAL FUNDING GATE — CellFlow

Do not request a standalone CellFlow grant until:

- [ ] Root `package-lock.json` committed.
- [ ] `npm ci` clean clone works.
- [ ] Public CI is green.
- [ ] PostgreSQL migrations pass in CI.
- [ ] DB concurrency/idempotency tests pass.
- [ ] Real CKB Testnet transaction runs through CellFlow.
- [ ] Real ambiguous broadcast scenario is demonstrated.
- [ ] Restart/redeploy recovery is demonstrated.
- [ ] Two independent Testnet RPCs are configured.
- [ ] Primary RPC outage/failover is demonstrated.
- [ ] Wrong-network RPC rejection is demonstrated.
- [ ] Confirmation-depth evidence is retained.
- [ ] Expected created Cell is verified.
- [ ] Live Cell check is demonstrated.
- [ ] Negative assertion prevents business finalization.
- [ ] Webhook retry/replay behavior is evidenced.
- [ ] Per-intent evidence JSON is public.
- [ ] Project evidence export/hash is public.
- [ ] One external CKB application integrates CellFlow.
- [ ] External maintainer confirms the integration.
- [ ] Several weeks / preferably ~30 days of operational metrics are published.
- [ ] Security posture is externally reviewed before any Mainnet/production-security claim.
- [ ] Hosted-service vs reusable-core boundary is explicit.
- [ ] Grant milestones are objective and reviewer-verifiable.
- [ ] Grant budget covers only future work.

---

## Current repo-specific starting point

Already strong in this uploaded revision:

- intent persisted before network side effects;
- deterministic transaction identity before broadcast;
- explicit `SUBMISSION_UNKNOWN`;
- submission/chain/workflow state separation;
- reconciliation model;
- confirmation-depth handling;
- reorg evidence;
- expected created/live Cell assertions;
- PostgreSQL source of truth;
- idempotency and leases;
- RPC fallback/circuit breaker;
- network identity checks;
- scoped API keys;
- signed webhooks + durable outbox;
- operator console;
- evidence export;
- deterministic regression tests;
- production-readiness/security documentation.

Still funding-critical in this uploaded revision:

- missing root `package-lock.json`;
- no public GitHub Actions workflows;
- no retained real Testnet ambiguous-broadcast trace;
- no retained restart-recovery trace;
- no public real RPC failover trace;
- no independent adopter;
- no long-running operational metrics;
- no external security review for production/Mainnet claims.

**Priority order:** reproducible release/CI -> real ambiguous Testnet proof -> restart + RPC failover proof -> external integration -> operational metrics -> external security review -> standalone grant.
