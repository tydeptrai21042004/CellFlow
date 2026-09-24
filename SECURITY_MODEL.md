# Security Model

## Trust boundary

CellFlow is non-custodial. It accepts public transaction identity, signed transaction workflow context, application metadata and expected-state assertions. It never needs private keys, seed phrases or wallet recovery material.

## Implemented controls

- API keys are generated with cryptographic randomness and stored only as SHA-256 hashes.
- Every tenant-owned query includes `project_id`.
- `(project_id, intent_id)` is enforced by PostgreSQL uniqueness.
- External request payloads are schema validated.
- Transaction hashes use strict 32-byte hex validation.
- State history is append-only in ordinary application paths.
- Execution projection updates use optimistic version checks.
- Webhook endpoints receive independent secrets, encrypted at rest with AES-256-GCM derived from `CELLFLOW_MASTER_SECRET`.
- Webhook requests are HMAC-SHA256 signed with timestamp/replay-window verifier support.
- Webhook retries are durable and separate from transaction correctness.
- Webhook redirects are not followed.
- Private, loopback, link-local, multicast and documentation/reserved address ranges are blocked.
- DNS is re-resolved immediately before delivery and the outgoing socket is pinned to the validated public IP while preserving TLS SNI/Host, reducing DNS-rebinding exposure.
- RPC calls have timeouts and response-size bounds.
- CellFlow never automatically interprets a broadcast timeout as failure/rebroadcast permission.

## Webhook signature

```text
canonical = v1.<unix_timestamp>.<raw_body>
X-CellFlow-Signature: v1=<hex-hmac-sha256>
X-CellFlow-Timestamp: <unix_timestamp>
X-CellFlow-Event-Id: <event uuid>
X-CellFlow-Delivery-Id: <delivery uuid>
```

Use `verifyWebhookSignature()` from `@cellflow/webhooks` with a short replay window.

## Remaining production review items

Before handling production-value applications:

- add project-level rate limiting at the edge/API layer;
- define retention/deletion policy;
- add API-key rotation/revocation UI/endpoint;
- add structured secret-redacting logger and centralized audit sink;
- run dependency/SAST audit in CI;
- perform an external SSRF/cross-tenant review;
- use operator-controlled CKB RPC with an appropriate SLA.
