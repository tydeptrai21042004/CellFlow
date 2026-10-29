# Fix CellFlow GitHub Actions #14 and #15: 80/81 runtime tests

## Root cause

The runtime regression in `tests/runtime/funding-automation.test.mjs` expects
`package.json`'s `test:db-integration` script to contain `db-settlement`.
The PostgreSQL CI patch replaced that script with
`node scripts/run-db-integration.mjs` to enforce database isolation.
This is a stale test assertion rather than a database runtime failure.

## Changed file (only)

- `tests/runtime/funding-automation.test.mjs`

The new assertion verifies the runner's fail-closed guard, migrations, both
real PostgreSQL test suites, and the must-run test flag.

## Apply

1. Copy the ZIP's `tests/runtime/funding-automation.test.mjs` into the
   same relative location in the CellFlow repository and replace that file.
2. Commit and push to main.
3. Recheck `CellFlow CI + Real CKB Testnet` in GitHub Actions.

```bash
git add tests/runtime/funding-automation.test.mjs
git commit -m "test: update DB integration runner contract assertion"
git push origin main
```

## Verified locally

`node --test` on the 13 runtime test files used by `npm test`:
81 tests, 81 passed, 0 failed, 0 skipped.

The PostgreSQL 16 integration job has not been executed here. It should run
after the offline CI job passes in GitHub Actions.

The Node 20 action deprecation and missing package-lock.json warnings are
separate from this failing assertion and do not require changing database code.
