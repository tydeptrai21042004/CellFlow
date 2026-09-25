# Security Model — V0.2

## Trust boundary

CellFlow is non-custodial. It accepts public transaction identity, application metadata and expected-state assertions. It never needs private keys, seed phrases or wallet recovery material.

## Implemented controls

- API keys are cryptographically random and stored only as SHA-256 hashes.
- API keys can be listed by prefix/metadata, rotated and revoked; the final active key cannot be revoked accidentally.
- Project API calls use a database-backed per-minute limiter.
- The server-only `CELLFLOW_ENCRYPTION_KEY` is separate from `CELLFLOW_BOOTSTRAP_TOKEN`.
- Production bootstrap can be disabled with `CELLFLOW_SETUP_ENABLED=false`.
- The browser keeps service API keys in page memory rather than Web Storage.
- Every tenant-owned database query is project-scoped.
- `(project_id, intent_id)` is enforced by PostgreSQL uniqueness.
- External request payloads are schema validated; empty Cell assertions are rejected.
- Transaction hashes use strict 32-byte hex validation.
- State changes, audit events and webhook outbox records are committed atomically.
- Projection updates use optimistic version checks with bounded retry.
- Reconciliation and webhook workers use expiring leases plus `FOR UPDATE SKIP LOCKED`.
- Durable Workflow starts are deduplicated per execution and stale runs can be replaced.
- Webhook endpoints receive independent secrets encrypted with AES-256-GCM.
- Webhook requests are HMAC-SHA256 signed with timestamp/event/delivery IDs.
- Webhook redirects are not followed; response size and request duration are bounded.
- Private, loopback, link-local, multicast and documentation/reserved address ranges are blocked.
- DNS is re-resolved immediately before webhook delivery and the socket is pinned to the validated public IP while preserving TLS SNI/Host.
- Configurable RPC URLs pass the same public-address/HTTPS validation policy in production.
- RPC calls have timeouts and response-size bounds.
- A single reconciliation observation stays on one RPC endpoint to avoid combining inconsistent node views.
- Previously committed blocks are checked against canonical `get_block_hash` before a downgrade is classified as reorg evidence.
- CellFlow never interprets a broadcast timeout as permission to automatically rebroadcast.

## Webhook signature

```text
canonical = v1.<unix_timestamp>.<raw_body>
X-CellFlow-Signature: v1=<hex-hmac-sha256>
X-CellFlow-Timestamp: <unix_timestamp>
X-CellFlow-Event-Id: <event uuid>
X-CellFlow-Delivery-Id: <delivery uuid>
```

Use `verifyWebhookSignature()` from `@cellflow/webhooks` with a short replay window and receiver-side event-ID deduplication.

## Remaining production review items

- define retention/deletion policy for raw observations, events and evidence;
- add API-key scopes/roles if CellFlow becomes a multi-user hosted service;
- add structured secret-redacting logging and a centralized audit sink;
- run dependency/SAST and external SSRF/cross-tenant reviews;
- run Postgres concurrency/failure integration tests in CI against real repository methods;
- use operator-controlled CKB RPC providers with explicit network/genesis verification and an appropriate SLA.
