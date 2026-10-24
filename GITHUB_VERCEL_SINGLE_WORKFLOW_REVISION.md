# CellFlow: GitHub Actions + Vercel (single workflow, no Actions database)

This patch is based on commit `7b773b25d5e211aa0a7754e2f8f994cbca3172bb` of the supplied ZIP.

## Infrastructure boundary

- **Vercel owns its existing PostgreSQL connection.** Leave `DATABASE_URL`, migrations and Vercel secrets untouched.
- **GitHub Actions does not start PostgreSQL, migrate any DB, or receive `DATABASE_URL`.** CI tests mock/offline behavior only.
- **Manual live Testnet Actions** call the deployed Vercel API using a dedicated test-project `CELLFLOW_TESTNET_API_KEY`. The API talks to the existing database. Never use a production project/API key to run spending tests.
- **One `.github/workflows/ci.yml`**, with `ci` on push/PR/manual and funded `testnet` only on manually dispatched `main`, after `ci` succeeds and protected `ckb-testnet` Environment approval.
- The live test uses **real blockchain transactions**: it requires two isolated Testnet wallets with funds and enough block confirmation time. Offline CI success is not evidence of live Testnet success.

## Once per repository

1. Copy the directories from this patch ZIP into the same paths at repo root and commit.
2. Generate and **commit a genuine `package-lock.json`** using Node 22/npm 10.9.2 on a networked machine: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. The patch ZIP does *not* contain a synthetic lockfile; package registry access was unavailable where this patch was built.
3. After the lockfile is committed, CI uses `npm ci` reproducibly. Before then, CI generates an **ephemeral** lockfile for that run, explicitly warns that it has not been committed, and uploads it as `cellflow-proposed-lockfile-<run_id>`; download and commit that file to close the debt.
4. Keep GitHub Environment `ckb-testnet` protected and wallet secrets away from normal PR jobs. Configure **Environment secrets** `CKB_TESTNET_PRIVATE_KEY_A`, `CKB_TESTNET_PRIVATE_KEY_B`, `CELLFLOW_TESTNET_API_KEY`; **Environment variables** `CELLFLOW_DEPLOYED_SHA`, `CKB_TESTNET_GENESIS_HASH`, `CELLFLOW_URL`, `CKB_RPC_URL`, `CKB_RPC_FALLBACK_URLS`, `CELLFLOW_TESTNET_ADDRESS_A`, and `CELLFLOW_TESTNET_ADDRESS_B`.
5. Update `CELLFLOW_DEPLOYED_SHA` to the **actual deployed Vercel SHA** for the submitted commit. It is intentionally **not inferred from** `github.sha`, because deployment may lag source.
6. The public deposit addresses configured through Environment variables `CELLFLOW_TESTNET_ADDRESS_A/B` (or their current YAML defaults) MUST match the secrets' derived signing addresses. Fund only disposable, TESTNET-only wallets (at least the configured minimum in the harness). Never share private keys.
7. In GitHub Actions choose **CellFlow CI + Real CKB Testnet** → **Run workflow** → `main` → `run_live_testnet = true`. The release/chain checks fail closed before broadcasting if SHA/genesis/wallet mismatches.

## Evidence

- A green **CI** job demonstrates offline tests/typecheck/build for that commit; no database or live-chain evidence is implied.
- A green **Testnet** job demonstrates the four real-chain scenarios from the live suite. It publishes an always-uploaded safe status artifact and, on success only, verified redacted evidence.
- Failed jobs still publish sanitized diagnostics; never publish raw wallet keys, API tokens, unredacted network payloads or database URLs.
- The replacement scenario now durably prepares/fingerprints the replacement attempt **before** submitting it to an RPC. This change must be deployed to Vercel before expecting the live job to succeed on matching SHA.

## Exact remaining debt

- A committed lockfile is still needed until the generated artifact is committed.
- No funded test was executed while producing the patch; a successful manual live workflow is required.
- Full database integration tests require an isolated database. They are **intentionally not run** against your existing Vercel production database or provisioned in Actions.
- Independent third-party CellFlow integration and actual deployed restart/reorg operational acceptance remain separate milestones.
