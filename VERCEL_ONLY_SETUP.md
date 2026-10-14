# CellFlow — Vercel-only deployment (NO GitHub Actions)

This patch is based on the uploaded `CellFlow-main(9).zip` and is designed to fix the October 14, 2026 build failure (`npm ci` / `EUSAGE`, missing `package-lock.json`). No `.github/workflows` files are required or created.

## 1. Apply changed files

Copy all patch paths into the root of the existing CellFlow repository. **Keep the subdirectory structure.** Commit and push the changes to `main` so Vercel builds that commit.

## 2. Why the old deployment failed and what changed

The old `vercel.json` always ran `npm ci`, but `package-lock.json` was not in the repository. `npm ci` cannot run without that file.

Now Vercel runs `node scripts/vercel-install.mjs`:

- With a **valid** `package-lock.json`: `npm ci --no-audit --no-fund` (reproducible, preferred).
- Without a lockfile: `npm install --no-audit --no-fund --package-lock=false` (bootstrap fallback; supports initial deployment).
- With a **malformed** lockfile: the installer fails rather than silently ignoring it.

The unlocked fallback allows deployment but cannot promise fully reproducible transitive dependency versions. **Generate a real lockfile later** on a networked local machine:

```sh
node -v                    # Node 22.x
npm install --package-lock-only --ignore-scripts
npm ci
npm run release:check
npm run test:review-regressions
npm run build
# Commit and push package-lock.json to enable fully locked Vercel builds.
```

Use `npm run release:vercel` to inspect Vercel-only preflight checks without requiring a committed lockfile; `npm run release:check` remains strict and requires a lockfile.

## 3. Vercel project settings

Vercel Dashboard -> Project `CellFlow` -> Settings -> Build and Deployment:

- Root Directory: repository root (not `apps/web`).
- Framework Preset: Next.js.
- Install Command: the repository's `vercel.json` sets `node scripts/vercel-install.mjs`.
- Build Command: `npm run ci:vercel`.
- Node.js Version: **22.x** (the `engines` field forces Node 22 even if your Vercel Project Settings currently say 24.x).

The Vercel build checks preflight, deterministic HTTP/client and blockchain regressions, TypeScript, and the Next.js build. It does not broadcast real Testnet transactions or run destructive database tests during build.

## 4. Required Vercel environment variables

Add these in Vercel -> Project -> Settings -> Environment Variables (Production). See `.env.example` for the non-secret keys and recommended options.

| Name | Where to get it |
|---|---|
| `DATABASE_URL` | Existing Neon/PostgreSQL connection string, set as a secret |
| `CKB_NETWORK` | `testnet` |
| `CKB_RPC_URL` | Your verified primary Testnet JSON-RPC HTTPS URL |
| `CKB_RPC_FALLBACK_URLS` | A verified independently operated Testnet JSON-RPC HTTPS URL |
| `CKB_EXPECTED_GENESIS_HASH` | Full hash from CKB RPC `get_block_hash` with `["0x0"]`; verify both RPC endpoints agree |
| `CELLFLOW_ENCRYPTION_KEY` | Existing stable encryption secret (>=32 chars): **do not rotate without key migration** |
| `CELLFLOW_BOOTSTRAP_TOKEN` | Existing bootstrap credential, if used for first-time setup |
| `CELLFLOW_SETUP_ENABLED` | `false` once a project has been provisioned |
| `CRON_SECRET` | Generate securely once, e.g. `openssl rand -hex 32`; keep it out of Git |
| `CELLFLOW_POST_CONFIRMATION_MONITOR_MS` | `3600000` (one hour; meaningful only when reconciliation actually runs) |
| `NEXT_PUBLIC_APP_URL` | `https://cellflow-brown.vercel.app` |

After changing variables, **redeploy**. Do not put CKB wallet private keys in the Vercel project. Signing stays outside CellFlow.

## 5. Vercel maintenance (no external cron)

The committed `vercel.json` retains a **daily** cron (`0 0 * * *`) that works on Hobby as a bounded repair sweep. Durable Vercel Workflow execution remains the normal reconciliation path. Vercel's cron is not an exact execution-time guarantee.

If on a paid plan supporting more frequent cron, change only `crons[0].schedule` to `*/5 * * * *` for 5-minute repair sweeps. Do not use that cron frequency on Hobby. The endpoint `/api/internal/maintenance` is protected by `CRON_SECRET` and runs bounded DB/reconcile/webhook tasks.

To run manually from your own terminal, without exposing the secret in shell history:

```sh
read -rs CRON_SECRET; echo
curl --fail-with-body -H "Authorization: Bearer ${CRON_SECRET}" \
  https://cellflow-brown.vercel.app/api/internal/maintenance
unset CRON_SECRET
```

## 6. Database migrations

Run **once** from a trusted workstation or temporary environment with `DATABASE_URL` set, targeting a staging database first:

```sh
npm ci                  # after package-lock.json is committed
npm run migrate
npm run test:db-integration  # use an isolated test DB, never live production data
```

Alternatively use `npm install` before generating the lockfile. Do not run migrations on every Vercel build: deployments should not mutate the production DB automatically. If `CELLFLOW_AUTO_BOOTSTRAP=true`, the server can apply migrations with advisory locks on its first request, but enable that only after reviewing bootstrap controls and credentials.

## 7. Exact deployed SHA verification

Find the full commit SHA in GitHub's commit view or `git rev-parse HEAD`. After Vercel deploys that commit:

```sh
npm run verify:deployment -- https://cellflow-brown.vercel.app <40-character-git-sha>
```

The script requires HTTPS, a healthy `/api/ready` response and an exact SHA match. It never needs your API key or private key. This is a source/deployment identity check, **not** proof that real Testnet recovery succeeded.

## 8. Testnet reviewer proof

A Vercel deployment is not a substitute for executing Testnet broadcasts and evidence exports. Run the existing `npm run validate:testnet-live` command **explicitly** on a trusted, dedicated local Testnet machine using two funded Testnet-only wallets and `.env.testnet.local` (never checked into Git). Keep the signing keys off the CellFlow service. Publish only redacted SHA-pinned evidence.

## 9. Troubleshooting

- `EUSAGE: npm ci requires package-lock.json`: confirm the new `vercel.json` was pushed and Vercel is building that commit, without a Project Settings override.
- `NODE 22/24 warning`: set the Vercel project Node.js version to 22.x. The code deliberately targets Node 22.
- `Cannot find module`: check Root Directory is repository root, and that Vercel used the installer from the new commit.
- `release:check` fails only on lockfile: expected in unlocked bootstrap; use `release:vercel` for the temporary Vercel deployment. Commit a real lockfile to close this gap.
- `/api/ready` returns 503: inspect DB migrations, `CRON_SECRET`, RPC reachability, setup status and genesis pin. The public response includes a safe status/action code.
- Five-minute cron rejected: keep daily on Hobby or upgrade the Vercel plan.

**No GitHub Actions workflows, GitHub secrets, or automatic wallet-signed broadcasts are required.**
