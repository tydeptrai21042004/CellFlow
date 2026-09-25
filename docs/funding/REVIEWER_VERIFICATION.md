# Funding Reviewer Verification Path

CellFlow funding claims should be tied to artifacts a reviewer can reproduce.

## 1. Code and release

```bash
npm run release:check
npm ci
npm run migrate
npm test
npm run typecheck
npm run build
```

The release commit should include `package-lock.json`; a release without the lockfile should not be presented as the production release.

## 2. Live deployment

Verify:

- `/api/health` returns healthy database status;
- `/api/health/rpc` reaches the configured CKB RPC;
- `/api/ready` returns 200; use an admin-scoped API key to inspect the detailed production checks (bootstrap lock, critical secrets, network/genesis identity, HTTPS transport and RPC redundancy).

## 3. Real CKB lifecycle

Use a real testnet transaction and show:

1. intent created before broadcast;
2. deterministic tx hash persisted;
3. pending/proposed/committed observations;
4. confirmation policy satisfied;
5. expected Cell assertion verified;
6. machine-readable evidence exported.

For the strongest external proof, run an ambiguity exercise where the submit response is intentionally lost after broadcast, then show CellFlow recovering by the persisted tx hash without an automatic second broadcast.

## 4. Operational proof

Export `GET /api/v1/project-evidence` for a read-only snapshot. For a durable reviewer checkpoint, an administrator can call `POST /api/v1/project-evidence`. The snapshot includes release version/commit identity when available, project-wide lifecycle metrics, operational backlog/staleness signals, webhook delivery health, credential-health counts, and a SHA-256 integrity fingerprint.

Reviewers can also inspect:

- scoped/expiring API-key behavior;
- webhook dead-letter retry;
- RPC fallback/circuit breaker;
- wrong-network custom RPC rejection;
- operator audit notes;
- readiness warnings for single-RPC deployments.

## 5. Adoption evidence

A larger Community Fund DAO request should attach evidence from at least two independently maintained CKB applications rather than only demos owned by the CellFlow author.

For each integration, record:

- public repository + commit/PR;
- exact integration surface used;
- count of real testnet operations;
- one captured recovery/failure scenario;
- maintainer feedback, including limitations.

## 6. Claims that are safe to make

Use bounded claims such as:

- “persists transaction identity before broadcast”;
- “reconciles known transaction hashes after ambiguous submit outcomes”;
- “supports confirmation-depth and expected-Cell verification”;
- “provides signed webhook delivery with retries and SSRF protections”;
- “exports reproducible operational evidence.”

Avoid claims of exactly-once blockchain execution, universal CKB compatibility, guaranteed uptime, or audited production security until independently demonstrated.
