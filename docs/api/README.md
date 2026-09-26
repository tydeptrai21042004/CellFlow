# CellFlow REST API

The V1 API is implemented by the Next.js route handlers under `apps/web/app/api`. Project endpoints use `Authorization: Bearer cf_live_...`; `/api/setup` is bootstrap-only and instead requires `Authorization: Bearer <CELLFLOW_BOOTSTRAP_TOKEN>` to match `CELLFLOW_ENCRYPTION_KEY`.

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

The public response contains a derived `status` plus independent `submissionStatus`, `chainStatus`, and `workflowStatus`. This prevents RPC observations such as `UNKNOWN` from being confused with broadcast outcome or durable workflow state. It also contains a derived `recommendedAction` (`NONE`, `WAIT_FOR_RECONCILIATION`, `WAIT_AND_RECONCILE`, `REBUILD_FROM_LIVE_STATE`, `RECONCILE_CANONICAL_STATE`, or `MANUAL_REVIEW`) so applications can react without giving CellFlow custody or transaction-signing authority.

## Evidence

`GET /api/v1/intents/{intentId}/evidence` returns the lifecycle snapshot, append-only state events, `recommendedAction`, and deterministic hashes over the canonical JSON representation. `snapshotSha256` includes export metadata such as `generatedAt`; `contentSha256` excludes the export timestamp so unchanged project state has a stable content fingerprint. Evidence is an audit artifact, not a consensus proof.

## Input preflight errors

Prepared transactions are checked against the configured CKB RPC before broadcast. CellFlow distinguishes stale and uncertain input state instead of reporting every failure as an invalid signed transaction:

- `INPUTS_NOT_LIVE` (`409`): one or more inputs are canonically spent.
- `INPUTS_CONTENDED` (`409`): inputs are canonically live but unavailable when the transaction pool is included.
- `INPUT_STATE_UNCERTAIN` (`503`): CellFlow cannot establish a safe input state from the RPC evidence.

Applications should treat these as operational state, not signing-format errors.

## Webhooks

Each webhook receives its own `whsec_...` signing secret. Delivery is HMAC signed with timestamp and delivery/event identifiers, retried with backoff, DNS-resolved before connect, and does not follow redirects. Keep the secret on the receiver and deduplicate by delivery/event ID.
