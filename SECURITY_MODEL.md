# Security Model — V0.3

## Trust boundary

CellFlow is non-custodial. It accepts public transaction identity, application metadata and expected-state assertions. It never needs private keys, seed phrases or wallet recovery material. Wallet signing stays outside CellFlow.

## Implemented controls

### Credentials and tenant isolation

- API keys are cryptographically random and stored only as SHA-256 hashes.
- Keys have explicit `read`, `write`, and `admin` scopes and optional expiry; `admin` is intentionally privileged.
- Revoked/expired keys cannot authenticate; the repository prevents accidental revocation of the last live key.
- Valid-key request limits use a database-backed bucket per API-key identity.
- The server-only `CELLFLOW_ENCRYPTION_KEY` is separate from `CELLFLOW_BOOTSTRAP_TOKEN`.
- Production bootstrap is expected to be disabled with `CELLFLOW_SETUP_ENABLED=false` immediately after provisioning.
- The browser keeps project API keys in page memory rather than Web Storage.
- Tenant-owned database operations are project-scoped.

### Transaction/reconciliation integrity

- `(project_id, intent_id)` idempotency is enforced by PostgreSQL uniqueness.
- Transaction hashes use strict 32-byte hex validation and are persisted before broadcast in the CCC integration boundary.
- CellFlow does not interpret a timeout/ambiguous broadcast as permission for blind automatic rebroadcast.
- Submission, chain and workflow state are separate to avoid hiding uncertainty.
- State changes, audit events and webhook outbox records are committed atomically.
- Projection updates use optimistic version checks with bounded retry.
- Reconciliation/webhook workers use expiring leases and `FOR UPDATE SKIP LOCKED`.
- Durable Workflow starts are deduplicated per execution and stale claims can be replaced.
- A single reconciliation observation stays on one RPC endpoint rather than combining inconsistent node views.
- Previously committed blocks are checked against canonical `get_block_hash` before a downgrade is classified as reorg evidence.
- Created/live Cell assertions use bounded, explicit fields rather than arbitrary executable policy.

### RPC and upstream safety

- RPC calls have bounded timeout and response size.
- Multiple independently configured RPC endpoints can fail over; repeated failures enter a bounded in-process cooldown circuit breaker.
- Project-configured production RPC URLs must be HTTPS/public-address destinations at provisioning time.
- Project setup checks `get_blockchain_info` against the selected CKB network.
- `/api/ready` independently validates the configured global network identity and can pin `CKB_EXPECTED_GENESIS_HASH`.
- Production readiness rejects plain HTTP RPC unless `CKB_ALLOW_INSECURE_RPC=true` is explicitly set.
- Production readiness warns when only one RPC endpoint exists.
- Detailed readiness posture is redacted from unauthenticated production callers; an admin API key can retrieve it.

### Webhook safety

- Webhook endpoints receive independent secrets encrypted with AES-256-GCM.
- Webhook requests are HMAC-SHA256 signed with timestamp/event/delivery IDs.
- Redirects are not followed; response size and request duration are bounded.
- Private, loopback, link-local, multicast, documentation and reserved destination ranges are blocked.
- DNS is re-resolved immediately before delivery and the socket is pinned to the validated public IP while preserving TLS SNI/Host.
- Endpoint disable preserves delivery history; failed deliveries require an explicit operator retry.

### HTTP, audit and evidence

- JSON bodies are bounded before parsing.
- API errors use stable codes, no-store responses, request correlation IDs and structured server-side logs that avoid dumping request bodies/secrets.
- Defensive browser headers disable framing/sniffing and unnecessary browser capabilities.
- Intent evidence is deterministic and hashed.
- Read-only project evidence export has no database-write side effect; durable recording requires admin scope.
- Project evidence can include release version and Vercel/custom commit SHA for reproducibility.

## Webhook signature

```text
canonical = v1.<unix_timestamp>.<raw_body>
X-CellFlow-Signature: v1=<hex-hmac-sha256>
X-CellFlow-Timestamp: <unix_timestamp>
X-CellFlow-Event-Id: <event uuid>
X-CellFlow-Delivery-Id: <delivery uuid>
```

Use `verifyWebhookSignature()` from `@cellflow/webhooks` with a short replay window and receiver-side event-ID deduplication.

## Remaining release/security gates

- Generate and commit `package-lock.json`; run clean `npm ci`, typecheck and production build in CI.
- Define a documented retention/deletion policy for raw observations, events and evidence exports.
- Run real PostgreSQL concurrency/failure integration tests rather than only deterministic source/unit tests.
- Use operator-controlled production CKB RPC providers with explicit ownership/SLA and independently operated fallback(s).
- Exercise database backup/restore and incident credential rotation in staging.
- Add dependency/SAST/SBOM scanning and release provenance/signing in the network-enabled release pipeline.
- Obtain an external review focused on SSRF/upstream networking, cross-tenant authorization, replay/idempotency boundaries, webhook signing, and recovery semantics before mainnet production use.
