# CellFlow PostgreSQL CI: settlement and webhook retry fix

This is an INCREMENTAL PATCH for CellFlow-main(2).zip **after** applying the
CellFlow_PostgreSQL_CI_Minimal_9_Files.zip and the one-file offline CI fix.
It contains only the eight code/test files listed below. Keep all other
project files unchanged.

## Why the PostgreSQL job failed

- Integration cases #7 and #8 called the async `repository.executionPublicView`
  without `await`. Reading `.settlementReady` from the Promise returned
  `undefined` instead of the expected boolean.
- Integration case #9 exposed a real configuration bug. `Number(undefined ?? '')`
  evaluates to zero; the integer parser clamped this to the lower bound,
  reducing the intended default `CELLFLOW_WEBHOOK_MAX_ATTEMPTS=8` to `1`.
  On the first HTTP 503, delivery was incorrectly marked `FAILED`, not `RETRY`.
- The same parser problem also affected the default webhook concurrency,
  webhook lease, webhook timeout, and CKB reconciler concurrency/timeout.
  The patch puts one shared `boundedInteger` helper in `@cellflow/core`
  and uses it across all three locations.

## Changed files (preserve paths when copying)

- NEW `packages/core/src/config.ts`
- UPDATE `packages/core/src/index.ts`
- UPDATE `packages/webhooks/src/delivery.ts`
- UPDATE `workflows/webhook-delivery/src/index.ts`
- UPDATE `workflows/webhook-delivery/package.json`
- UPDATE `workflows/reconcile/src/reconcile.ts`
- UPDATE `tests/integration/db-settlement.test.mjs`
- UPDATE `tests/runtime/core.test.mjs`

No migrations, production database values, secrets or chain logic are changed.

## Apply

Extract this ZIP at the project root and replace matching files. Commit:

```bash
git add packages/core/src/config.ts packages/core/src/index.ts \
  packages/webhooks/src/delivery.ts \
  workflows/webhook-delivery/src/index.ts workflows/webhook-delivery/package.json \
  workflows/reconcile/src/reconcile.ts \
  tests/integration/db-settlement.test.mjs tests/runtime/core.test.mjs
git commit -m "fix: restore webhook defaults and await settlement views"
git push origin main
```

## Validation

Locally: TypeScript core compilation + all 31 core tests passed,
plus 17 GitHub CI/DB safety regression tests passed (48 in total).
Full project typecheck requires `npm install` (dependencies are not installed
in this verification runtime); real PostgreSQL integration tests must run in
GitHub Actions. No real DB was contacted or modified here.

GitHub Actions -> CellFlow CI + Real CKB Testnet ->
PostgreSQL 16 integration (automatic, ephemeral)

Expected behavior: migrations 001–009 apply, all 9 DB integration tests pass;
case #9 retries the first intentional HTTP 503, then delivers the webhook
exactly once and verifies the signature. The GitHub run is the authority for
actual DB behavior; do not claim it has passed until CI says so.

## Security

Do not paste Neon/Vercel credentials into CI YAML or source code. This patch
uses no credentials and preserves the disposable PostgreSQL Actions service.
Rotate the Neon password previously pasted into chat.
