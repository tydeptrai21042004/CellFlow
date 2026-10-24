# CellFlow: GitHub Actions hotfix — October 24, 2026

This incremental patch is designed to overlay the earlier `CellFlow_Vercel_NoDB_OneWorkflow_Revision_Patch.zip` that was uploaded to the repository. It fixes GitHub Actions run #11's npm `EUSAGE` / mixed Zod 3.25.76 and 4.6.5 lockfile failure.

## Change in dependency installation

With no committed `package-lock.json`, **never** generate an ephemeral npm workspace lockfile using `npm install --package-lock-only` followed by `npm ci`. In this project that sequence can produce nested Zod entries that fail npm's own lockfile consistency check.

The single `.github/workflows/ci.yml` now uses:

```bash
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --package-lock=false --no-audit --no-fund
fi
```

It uses this in both the offline CI job and the manually-triggered live-Testnet job. It no longer generates or uploads a proposed lockfile. **A lockfile is optional**, though without one installs are not guaranteed to be reproducible across dates.

If you later commit a lockfile, generate and validate it in a networked development environment first; a malformed committed lockfile will correctly fail the `npm ci` branch. If the repo already has a bad lockfile, remove or repair it as a separate intentional change.

## No `.env` files or GitHub database

- `.env.example`, `.env.testnet.example` and `.env.local` are **not created or required** by the patch or release preflight.
- `.nvmrc` and `.gitignore` are optional source-only advisory files. Security best practice is still to retain a `.gitignore` to avoid accidental secret commits.
- The workflow never starts PostgreSQL, runs migrations, or receives `DATABASE_URL`. It keeps one workflow YAML, with two jobs: database-free CI on push/PR and manual funded Testnet after CI passes.
- The Testnet job uses the existing deployed Vercel API, which retains its own database connection.
- All Testnet wallet keys and API tokens remain GitHub Environment **Secrets**; public RPC addresses, expected deployment SHA, genesis hash, and wallet addresses remain Environment **Variables**. The live security gate is not bypassed.

## How to apply

1. Overlay the files in this ZIP at repository root **with their directories preserved**. This is an incremental patch; keep the previous patch's RBF safety and evidence helpers.
2. Commit and push to `main`.
3. Watch the **Offline release checks, typecheck, tests and build** job in your existing GitHub Actions workflow. You do not need to upload an env file, connect a database to GitHub, or upload a package lockfile.
4. After offline CI succeeds and Vercel has deployed the commit, choose **Run workflow** on `main` with `run_live_testnet=true` when you want to test real funded Testnet transactions. The protected `ckb-testnet` Environment still requires its existing configured secrets and vars.

## Validation performed for this patch

- `node scripts/release-preflight.mjs --strict` exits successfully with no lockfile and no env templates; reports `readyForGithubOfflineCI=true`, `reproducibleDependencies=false`.
- 31 targeted Node tests passed covering workflow invariants, fail-closed live configuration, release preflight, production-readiness and Vercel deployment contracts.
- Workflow YAML parsed; shell and JavaScript syntax checks passed.

**Not verified locally:** a complete npm dependency install, TypeScript build or funded Testnet transaction. Registry access and GitHub Environment secrets are not available in this container. The next GitHub Actions execution will provide the definitive install/build result. Do not interpret a green offline CI job as proof that live-Testnet transactions passed.
