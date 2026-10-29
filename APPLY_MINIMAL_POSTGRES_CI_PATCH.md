# Minimal PostgreSQL CI patch for CellFlow-main(2).zip

Contains exactly nine changed/new code/config files relative to your uploaded project, no duplicate unchanged files. Extract at your CellFlow repository root (replace same-name paths), then commit and push.

## Changed files
- `.github/workflows/ci.yml` (replace): automatic disposable PostgreSQL 16 job on GitHub push/PR plus optional manual isolated Neon branch job, with CKB Testnet job retained.
- `package.json` (replace): wire fail-closed DB test command and guard unit tests.
- `scripts/migrate.mjs` (replace): use direct DB URL when supplied and protect schema migration with transaction advisory lock.
- `tests/integration/db-concurrency.test.mjs` (replace): fail when DB is required but missing.
- `tests/integration/db-settlement.test.mjs` (replace): fail when DB is required but missing.
- `tests/runtime/github-testnet-ci.test.mjs` (replace): update the single-workflow CI contract checks.
- `scripts/db-test-guard.mjs` (add): reject production/unapproved DB targets.
- `scripts/run-db-integration.mjs` (add): run migration and real DB suite, fail instead of skipping.
- `tests/runtime/db-test-guard.test.mjs` (add): safeguard regression coverage.

## CI operation
- Push or PR: `ci` (offline checks) -> `db_postgres` (disposable PostgreSQL 16, no secrets).
- Optional Neon test: provision a separate Neon database branch, configure protected GitHub Environment `cellflow-db-integration` with secrets `CELLFLOW_TEST_DATABASE_URL` (pooled URL), `CELLFLOW_TEST_DATABASE_URL_UNPOOLED` (direct URL), and environment variables `CELLFLOW_TEST_DB_EXPECTED_HOST` (test pooled hostname), `CELLFLOW_PRODUCTION_DB_HOST` (production pooled hostname). Trigger `workflow_dispatch` on main with `run_db_integration=true`. Never point these secrets to production.
- Keep live funded CKB Testnet job manual (`run_live_testnet=true`) and separate from database tests.

## Not in this minimal patch
- `.gitignore` and `.nvmrc` (recommended repository hygiene).
- `/api/ready` monitor-window introspection and the related deployment test (optional reviewer-evidence improvement).
- Documentation from previous larger ZIP.
- `package-lock.json` is still missing in this source. Generate and commit a lockfile separately for fully reproducible installs.

## Validation
Local Node tests validating DB safeguards and the CI workflow were run after applying this patch. A real GitHub-hosted PostgreSQL service run is still required; no Neon database was contacted. Rotate any previously shared Neon password.
