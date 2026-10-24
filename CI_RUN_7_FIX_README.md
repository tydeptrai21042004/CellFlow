# CellFlow — GitHub Actions Run #7 npm EUSAGE fix

## Root cause

The old workflow used this sequence when `package-lock.json` was absent:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --no-audit --no-fund
```

This generated a workspace lockfile that `npm ci` rejected before installing dependencies:

```
Invalid: lock file's zod@4.6.5 does not satisfy zod@3.25.76
Missing: zod@4.6.5 from lock file
```

CellFlow's application explicitly depends on `zod@4.6.5`; a transitive dependency may need Zod 3. **Do not force Zod 3 onto the application, do not remove Zod 4, and do not manually edit lockfile versions.** This patch changes dependency bootstrapping, not application dependencies.

## Files changed

- `.github/workflows/ci.yml` — still the **only** GitHub Actions YAML; both jobs use a shared installer. Manual Testnet funding now defaults to `false` to prevent accidental sends.
- `scripts/ci-install.sh` — newly added database-free install helper. With a committed lock: strict `npm ci`. Without: full `npm install`, then `npm ci --dry-run` validation; if needed, a second lockfile serialization pass, then revalidation. Unvalidated locks are **not uploaded as proposed release locks**.
- `tests/runtime/ci-install.test.mjs` — tests missing-lock, committed-lock, broken-provisional-lock and install-failure behavior with a mocked npm. No network or DB.
- `package.json` — includes the installer regression tests in `test:github-offline` (no dependency versions changed).
- `GITHUB_VERCEL_SINGLE_WORKFLOW_REVISION.md` — updated lockfile instructions and evidence caveats.

## Apply safely

1. Copy the patch ZIP's contents into the root of the existing GitHub repository and **overwrite files at identical paths**. Do not replace the entire repo with this ZIP; it intentionally includes changed files only.
2. Commit and push the changes to `main`.
3. Check **CellFlow CI + Real CKB Testnet** in GitHub Actions. The offline job should now enter `scripts/ci-install.sh`, use a full `npm install` for the missing-lock case, and proceed to `release:check`, typecheck, tests and build.
4. If the generated lockfile passes a separate `npm ci --dry-run`, download `cellflow-proposed-lockfile-<run_id>` and commit its `package-lock.json` at the repository root. Push again; the new run will use strict `npm ci` without dependency re-resolution.
5. If the lockfile artifact **does not appear**, read the GitHub job summary. An invalid provisional lockfile is intentionally not provided for committing. Generate and verify a lock locally using Node 22 / npm 10.9.2 and then commit it. Do not circumvent `npm ci` with `--force` or `--legacy-peer-deps` unless an actual peer-dependency incompatibility is diagnosed and tested.
6. Only when offline CI is green, manually dispatch the same workflow with `run_live_testnet = true`, while ensuring the protected `ckb-testnet` GitHub Environment has the Vercel API key, network identity and funded isolated testnet wallet secrets configured.

## What this patch deliberately does **not** do

- It does **not** start a PostgreSQL service, run migrations, fetch `DATABASE_URL`, or run database-integration suites in GitHub Actions. The Vercel backend retains its existing database connection.
- It does **not** change Vercel's deployment install or build commands.
- It does **not** contain fabricated `package-lock.json` entries.
- It does **not** guarantee a green full npm installation/build: the external package registry is inaccessible from the patch-building environment, so dependency downloading and a complete clean install must be verified in GitHub Actions.
- It does **not** count a green offline job as live CKB Testnet proof; the manual Testnet job must pass independently.

## Local verification performed for this patch

- Bash parser accepted `scripts/ci-install.sh`.
- GitHub Actions YAML parsed successfully (one workflow containing two jobs).
- **40/40 targeted offline tests passed**, including the four new install-helper branch tests and the existing Testnet and Vercel contract tests.
- Real package download / `npm ci` against the full dependency graph was not possible due to package-registry DNS restrictions in this environment.
