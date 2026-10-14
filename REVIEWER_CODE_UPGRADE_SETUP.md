# CellFlow reviewer upgrade — code changes and setup

Baseline: the user's `CellFlow-main(8).zip`. This package contains source changes, not proof of a live deployment. **No Testnet writes, live database calls, or Vercel deployment were run while preparing this package.**

## 1. What changed

- `scripts/evidence/package-review-bundle.mjs`: accepts the real HTTP `fetchJson` wrappers for readiness (`200`) and project evidence (`201`), rejects unhealthy HTTP records and mismatched SHA, requires four named PASS scenarios and two Testnet RPC hosts with the same full genesis hash, and cross-checks packaged checksums against manifest entries.
- `scripts/evidence/live-safety.mjs` and `scripts/evidence/testnet-live-suite.mjs`: fail a strict reviewer run *before sending testnet transactions* if the live readiness SHA, pinned Testnet genesis, two distinct HTTPS RPC hosts or hosted readiness are wrong/missing.
- `tests/runtime/`: added contract tests for wrapped HTTP evidence, duplicate/mismatched scenarios and pre-broadcast identity policy.
- `tests/integration/db-settlement.test.mjs`: added real database/outbox + localhost HTTP receiver test for 503 retry, valid webhook HMAC, final 200, and no further deliveries after success.
- `.github/workflows/ci.yml`: deterministic source/test/build plus isolated PostgreSQL migration, outbox, lease and restart tests. **CI makes no chain writes.**
- `.github/workflows/maintenance.yml`: best-effort 5-minute authenticated hosted repair sweep, with bounded time and response validation. This supplements Vercel's existing once-a-day cron, not a substitute for durable worker scheduling.
- `.github/workflows/testnet-review.yml`: manual, explicitly authorized Testnet broadcasts with fresh wallet secrets, pinned deployed SHA, Testnet genesis and redacted artifact upload. GitHub environment approvals are strongly recommended.
- `.github/workflows/generate-lockfile.yml`: manual browser-based workflow to generate a real `package-lock.json` when npm network access is unavailable locally.
- `.nvmrc`, `.gitignore`, `.env.example`, `.env.testnet.example` and stronger `release-preflight` checks.

## 2. One-time code setup (required before CI can pass)

The Vercel `installCommand` now uses `npm ci` rather than `npm install` so deployments cannot silently use a drifting dependency tree. **Deployments will fail until the genuine lockfile is committed.**

The uploaded ZIP lacks `package-lock.json`. A **real** npm-generated lockfile must be committed. Do not hand-create or copy a lockfile from an unrelated release.

On a development machine with internet:

```bash
nvm use 22
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
git add package-lock.json .github .nvmrc .gitignore .env.example .env.testnet.example
# add the other modified files too
git commit -m "Harden CellFlow reviewer evidence and release workflows"
git push
npm ci --no-audit --no-fund
npm run release:check
npm run test:review-regressions
node --test tests/runtime/live-safety.test.mjs
npm run typecheck && npm run build
```

Alternative without local npm access: push the changed source files, open **GitHub → Actions → Generate npm lockfile (manual bootstrap) → Run workflow**, download its `cellflow-package-lock` artifact, place `package-lock.json` at repository root and commit it. Until the lockfile is committed, the new CI workflows are expected to fail at `npm ci`/release preflight.

## 3. GitHub Actions setup

In GitHub repository **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|---|---|---|
| Variable | `CELLFLOW_URL` | `https://cellflow-brown.vercel.app` (replace if needed) |
| Secret | `CELLFLOW_CRON_SECRET` | Same random secret as Vercel `CRON_SECRET` |
| Variable | `CKB_TESTNET_RPC_URL` | HTTPS Testnet RPC endpoint (no embedded credentials) |
| Variable | `CKB_TESTNET_RPC_FALLBACK_URLS` | One or more distinct-host HTTPS Testnet RPC URLs |
| Variable | `CKB_TESTNET_GENESIS_HASH` | Full 0x-prefixed 64-hex Testnet genesis hash confirmed independently |
| Secret | `CELLFLOW_TESTNET_API_KEY` | Project-scoped, Testnet-only CellFlow admin API key |
| Secret | `CKB_TESTNET_PRIVATE_KEY_A` | Private key for fresh Testnet-only funded wallet A |
| Secret | `CKB_TESTNET_PRIVATE_KEY_B` | Private key for fresh Testnet-only funded wallet B |

Only `CELLFLOW_URL` and `CELLFLOW_CRON_SECRET` are required for the maintenance workflow. The other variables/secrets are for **manual** Testnet runs. Do not put testnet private keys in normal CI, Vercel, application `.env`, public artifacts or review comments.

Create a GitHub **Environment** named `testnet-review` and set required reviewers/approval rules. Run the Testnet workflow only when you intend to spend Testnet CKB. The suite needs at least 250 Testnet CKB *per wallet* by default and may consume transaction fees; never provide Mainnet keys.

**Important:** GitHub scheduled workflows are best-effort; they can be delayed or skipped, especially under repository inactivity. A 5-minute cron does not guarantee observing every deep reorg or uninterrupted post-confirmation monitoring. For production-grade monitoring, use a persistent worker/external scheduler with alarms and durable heartbeat metrics.

## 4. Vercel setup

Use **Project Settings → Environment Variables** in the **Production** environment. Required existing variables include:

```text
DATABASE_URL                  Neon/PostgreSQL connection string
CKB_NETWORK                  testnet
CKB_RPC_URL                  HTTPS Testnet RPC
CKB_RPC_FALLBACK_URLS        independent HTTPS Testnet RPC(s)
CKB_EXPECTED_GENESIS_HASH    full verified 0x-prefixed hash
CELLFLOW_ENCRYPTION_KEY      strong random value (>=32 characters)
CELLFLOW_BOOTSTRAP_TOKEN     strong random value
CRON_SECRET                  strong random value (>=24 characters)
CELLFLOW_SETUP_ENABLED       false after initial setup is complete
CELLFLOW_POST_CONFIRMATION_MONITOR_MS  3600000
CELLFLOW_RECONCILE_CONCURRENCY        4
CELLFLOW_WEBHOOK_CONCURRENCY          6
CKB_ALLOW_INSECURE_RPC       false
```

Keep the initial project bootstrap/automatic setup contract described in `docs/operations/RUNBOOK.md`; do not switch off setup before initial creation. The one-hour horizon is an *example policy*, not CKB finality. Revocation/compensation remains the application's responsibility. Changing Vercel environment values requires a new deployment for those values to be available to its functions.

After deploying a **known Git commit**, call `/api/ready` with an admin bearer token (do not put the key into a URL). Record the full `releaseSha`. It must match `git rev-parse HEAD` for the deployed source. Run migrations first from a controlled environment:

```bash
export DATABASE_URL='postgresql://...'
npm run migrate
npm run test:db-integration
```

Use a dedicated database for CI/integration tests; do **not** point the GitHub PostgreSQL test job or disposable fixture tests at production.

## 5. Run and export Testnet evidence

After deploying the same source commit with the CI and evidence changes, open **Actions → CellFlow Testnet reviewer evidence (manual transaction writes) → Run workflow**. Specify:

- `confirm` = `YES_TESTNET_BROADCAST`
- `deployed_sha` = full 40-character SHA returned by hosted `/api/ready`

The workflow checks out **that SHA** (not a moving branch), validates the network identity, runs the four real Testnet scenarios, then publishes a *redacted* evidence artifact only on success. A missing or mismatched SHA/genesis causes the pre-broadcast guard to refuse transaction creation. The artifact is retained for 14 days; inspect it manually before publishing anywhere public.

Equivalent local use after copying `.env.testnet.example` into a private `.env.testnet.local` and supplying the required keys, full SHA, genesis and funded wallets:

```bash
npm run validate:testnet-live
node scripts/evidence/package-review-bundle.mjs \
  --source evidence/testnet/live/reviewer-run \
  --out evidence/testnet/reviewer-public \
  --sha YOUR_FULL_40_CHARACTER_DEPLOYED_SHA
node scripts/evidence/package-review-bundle.mjs --verify evidence/testnet/reviewer-public
```

The bundle documents four live scenarios and does not prove a real fork, full PostgreSQL/webhook service E2E, or Mainnet safety. The isolated DB job proves the underlying settlement/outbox/delivery code against PostgreSQL. Publish each type of evidence under the correct scope, and do not claim they are equivalent.

## 6. Remaining human/infrastructure work

1. Generate/commit the authentic `package-lock.json` and confirm clean CI, migrations, tests, build and Vercel deployment.
2. Configure GitHub secrets, variables, environment approval, Vercel secrets and monitoring alerting.
3. Execute Testnet transactions with dedicated funded wallets and independently inspect public hashes, raw RPC evidence, worker restart behavior and deployed SHA.
4. Run a controlled local CKB fork/re-inclusion exercise and verify `SETTLEMENT_REVOKED`/recovery. This **is not** covered by the provided live harness.
5. Perform an external security review of tenant authorization, webhook replay handling, secret redaction, RPC trust and infrastructure access.

Avoid claiming 100% reviewer completion until those environment-dependent validations are recorded.
