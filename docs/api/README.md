# CellFlow REST API

The V1 API is implemented by the Next.js route handlers under `apps/web/app/api`. Project endpoints use `Authorization: Bearer cf_live_...`; `/api/setup` is bootstrap-only and instead requires `x-cellflow-master-secret` to match `CELLFLOW_MASTER_SECRET`.

The machine-readable contract is [`openapi.yaml`](./openapi.yaml).

## Recommended transaction path

For a CCC application, prefer the `@cellflow/ccc` adapter rather than manually calling these endpoints:

1. Create an idempotent business intent.
2. Sign/prepare the CKB transaction.
3. Compute and persist the deterministic transaction hash with `/prepare` **before broadcast**.
4. Mark `/broadcasting` and call the CKB RPC.
5. On acknowledged broadcast, call `/submitted`.
6. On timeout/network ambiguity, call `/ambiguous`; do **not** blindly rebroadcast.
7. CellFlow reconciles the stored hash until committed/confirmed/rejected and verifies optional expected Cells.

For already-broadcast transactions, use `/track` instead.

## Idempotency

`intentId` is unique within a project. A second create request with the same `intentId`, metadata and expected-Cell assertions is safe and returns the existing object. Reusing the identifier with different input returns `409 INTENT_CONFLICT`.

## Status model

The public response contains a derived `status` plus independent `submissionStatus`, `chainStatus`, and `workflowStatus`. This prevents RPC observations such as `UNKNOWN` from being confused with broadcast outcome or durable workflow state.

## Evidence

`GET /api/v1/intents/{intentId}/evidence` returns the lifecycle snapshot, append-only state events and a deterministic SHA-256 over a canonical JSON representation. Evidence is an audit artifact, not a consensus proof.

## Webhooks

Each webhook receives its own `whsec_...` signing secret. Delivery is HMAC signed with timestamp and delivery/event identifiers, retried with backoff, DNS-resolved before connect, and does not follow redirects. Keep the secret on the receiver and deduplicate by delivery/event ID.
