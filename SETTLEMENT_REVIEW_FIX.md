# CellFlow settlement/reorg reviewer fix (base 5e4e226)

## Semantics

- `CONFIRMED` and `intent.confirmed` mean **chain confirmation only**. Never use these as business-finalization triggers.
- `settlementReady` is a separate predicate in the intent REST projection and evidence export.
- `intent.settlement_ready` is inserted into the same DB transaction/outbox as the assertion transition, **only when** the predicate changes from false to true.
- `intent.settlement_revoked` is emitted on a subsequent transition to false (e.g. detected reorg). This is an alert to assess application compensation, **not** an automatic undo.
- With required assertions, `PENDING` and `FAILED` are never ready. With no expected Cells configured, the required-assertions condition is vacuous; committed canonical evidence and chosen confirmation policy are still mandatory.
- `intent.confirmed` remains for backward compatibility; consumers MUST switch business effects to `intent.settlement_ready` and use the event's `id` as an idempotency key.

## Deployment

1. Apply `packages/db/migrations/009_settlement_monitoring.sql` via the existing migration process *before* running the new server code (`npm run migrate`). The bundle `packages/db/src/migrations.generated.ts` is regenerated.
2. Deploy the modified files together. Do not mix a previous runtime with the updated DB/webhook contract.
3. Optional: set `CELLFLOW_POST_CONFIRMATION_MONITOR_MS` to a finite horizon (e.g. `3600000` for one hour); default `0` stops automatic reconciliation when settlement is ready, as before. Maximum accepted value: seven days. Manual authenticated `POST /api/v1/intents/{intentId}/reconcile` remains available.
4. Ensure the existing scheduled `/api/internal/maintenance` repair sweep is enabled. The continuation of the durable primary workflow has a fixed iteration cap; scheduled maintenance covers later checks.
5. Your application owns compensating business effects for a deeper reorg after already-delivered settlement. 'Live' means live when observed, not permanent authorization. After settlement, monitor canonicality without re-running historic live-Cell checks on the same committed block. Legitimate later spending is not an automatic settlement revocation. A changed canonical block triggers fresh assertions.

## Validation

Run `npm run typecheck`, `npm run test:core`, `node --experimental-transform-types --test tests/runtime/settlement-review.test.mjs` and the existing integration suites. Testnet node evidence / real PostgreSQL integration tests are still necessary before claiming a full hosted E2E reproduction; this archive contains no credentials or verified deployment evidence.

## Local validation of this changeset

- Source: uploaded `CellFlow-main(5).zip`, archive root `5e4e226a72499c7ba1ffaa3f07410b6ba2bddfb8`.
- `npm run test:core`: **30 passed**.
- `node --experimental-transform-types --test tests/runtime/settlement-review.test.mjs`: **9 passed**.
- `node --test tests/runtime/ui.test.mjs`: **10 passed**.
- `tests/integration/db-settlement.test.mjs`: **2 tests defined, skipped** because `DATABASE_URL` was not available. Run against an isolated migrated PostgreSQL database before deployment.
- Full `npm run typecheck` and full build: **not verified** because the uploaded archive lacks an installed dependency tree and package installation timed out. The TypeScript errors include missing `postgres`, `zod`, and `@ckb-ccc/core` modules. Do not treat this changeset as a certified production build.
- An unrelated pre-existing production-readiness test failed because `.github/workflows/ci.yml` was not present in the uploaded ZIP. The clean-release preflight reports **six source-package blockers**: `package-lock.json`, `.nvmrc`, `.gitignore`, `.env.example`, `.env.testnet.example`, `.github/workflows/ci.yml`. Restore authentic versions from the repository and regenerate a reproducible lockfile; do not invent them.
- No public-Testnet transaction, deployed SHA, live DB/webhook replay, or controlled local fork execution is claimed here. The integration tests provide executable coverage when the appropriate infrastructure is connected.

## Installation of the patch ZIP

Extract these repo-relative files over the matching paths in your existing CellFlow checkout based on SHA `5e4e226a72499c7ba1ffaa3f07410b6ba2bddfb8` (or carefully merge if your HEAD differs). Run the migration before deploying the server-side code. Review and commit the diff, then run all application and integration tests against a fresh DB and CKB Testnet environment. Preserve the full webhook event history and idempotency logic in downstream consumers.
