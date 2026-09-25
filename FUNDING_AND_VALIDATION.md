# Funding and validation strategy — V0.3

## Positioning

CellFlow should be presented as a **CKB-native transaction operations and recovery layer**, not as another wallet, indexer, explorer, or transaction builder. Its strongest fundable claim is narrower: applications can persist transaction intent and identity before broadcast, survive ambiguous/network/serverless failures, independently reconcile chain state, verify expected Cells, and produce audit/reviewer evidence.

Funding should follow independently reproducible evidence. Architecture is useful, but milestones should end in outputs that a reviewer can run, inspect, or measure.

## What V0.3 can demonstrate now

- durable intent + transaction identity before broadcast;
- explicit ambiguous-submit recovery without automatic duplicate rebroadcast;
- canonical-chain reconciliation, confirmation depth, and reorg detection;
- expected created/live Cell verification;
- independent RPC fallback with cooldown circuit breaking;
- least-privilege scoped/expiring project API keys;
- signed webhooks with durable outbox, delivery leases, disable, health counters, and failed-delivery replay;
- operational health API/dashboard;
- intent evidence and project-level hashed evidence exports;
- deterministic offline regression suite.

These are engineering capabilities. Do not convert them into claims about zero loss, exactly-once blockchain execution, universal compatibility, or audited mainnet safety.

## Evidence package for a funding reviewer

A strong submission should include all of the following in one public release:

1. **Source + immutable release** — exact Git commit and version tag.
2. **Reproduction commands** — clean install, migration, tests, typecheck, build.
3. **Live deployment** — `/api/health`, `/api/ready`, dashboard, and documented API.
4. **Real CKB testnet trace** — intent creation → prepare hash → broadcast/ambiguous case → reconciliation → confirmation → expected-Cell assertion.
5. **Injected failure trace** — kill/restart serverless execution or fail the primary RPC and show recovery through durable state/fallback.
6. **Machine-readable evidence** — per-intent evidence JSON plus `/api/v1/project-evidence` snapshot and hashes.
7. **Independent pilot** — one application not maintained by the CellFlow author.
8. **Operational window** — at least several weeks of real metrics rather than a one-off demo.
9. **Security posture** — threat model, secret-rotation procedure, dependency lock, vulnerability scan, and external review when funding size justifies it.

See `docs/funding/REVIEWER_VERIFICATION.md` for the verification path.

## Suggested milestone structure

### Milestone 1 — reproducible production candidate

Deliverables:

- committed `package-lock.json` and green clean-install CI;
- staging deployment with production setup locked;
- pinned CKB network/genesis configuration and two independent RPC providers;
- all migrations, backup/restore exercise, 65+ deterministic tests, full typecheck/build;
- public threat model and runbook.

**Reviewer proof:** CI run, `/api/ready`, release tag, recovery test artifacts.

### Milestone 2 — real CKB recovery evidence

Deliverables:

- testnet transaction lifecycle through CCC integration;
- primary-RPC outage/failover exercise;
- ambiguous broadcast exercise;
- expected live-Cell assertion and confirmation-depth evidence;
- webhook delivery/retry evidence.

**Reviewer proof:** transaction hashes, CellFlow evidence exports, timestamped test script/output.

### Milestone 3 — independent adoption

Deliverables:

- one external CKB application integrates the REST/CCC boundary;
- 30-day anonymized operational metrics;
- documented integration friction and resulting API changes;
- compatibility/versioning policy.

**Reviewer proof:** external repository or maintainer confirmation plus metrics snapshot.

### Milestone 4 — security and ecosystem readiness

Deliverables:

- external security review and remediation;
- dependency/SBOM and release-signing workflow;
- disaster-recovery exercise;
- stable API/SDK release and migration policy.

**Reviewer proof:** published report, remediated commit hashes, restore exercise, signed release artifacts.

## Metrics worth collecting

- tracked operations and confirmed operations;
- `SUBMISSION_UNKNOWN` events and percentage recovered by reconciliation;
- duplicate intent attempts safely collapsed;
- reorg/conflict/rejection counts;
- due and stale reconciliation backlog;
- primary-RPC failures and fallback activations;
- median/p95 submit-to-commit observation time;
- webhook delivered/retried/failed counts and success rate;
- manual intervention count;
- active independent integrations;
- API key rotation/expiry compliance.

## Scope discipline

A first funding request should remain focused on transaction operations/recovery and validation. Avoid bundling unrelated wallet, Fiber/payment, mobile, billing, analytics, marketplace, or generic smart-contract-platform scope unless a funded milestone has a concrete adopter and verification path for it.

## Claims to avoid

Do not say:

- “exactly-once blockchain execution”;
- “guaranteed transaction success”;
- “audited” without an actual external audit;
- “production-ready” solely because deterministic tests pass;
- “works with every CKB application”;
- “replaces CCC, an indexer, or RPC infrastructure.”

Prefer bounded claims backed by a command, chain artifact, evidence hash, or operational metric.
