# CellFlow — Vercel build hotfix (commit `059244f`)

## What failed

The 2026-10-14 21:25 Vercel log shows **dependency installation succeeded**, then `npm run release:vercel` exited with code 1. Four files were missing from the deployed GitHub checkout:

- `.nvmrc`
- `.gitignore`
- `.env.example`
- `.env.testnet.example`

These are source/developer support files, not runtime inputs for Vercel. The previous release preflight incorrectly made their presence mandatory even for the deployment-only gate. The missing npm lockfile remains a **warning** for Vercel bootstrap mode.

## Hotfix contents

1. `scripts/release-preflight.mjs`
   - In `--vercel` mode, missing support dotfiles and environment-template entries become explicit **warnings**, not deploy blockers.
   - In `--strict` mode, source-release completeness is still required.
   - Missing actual production artifacts (database migrations, evidence handlers, `vercel.json`, build/installer scripts, etc.) still fail both modes.
   - `readyForCleanReleasePipeline` stays false when the source support files/lockfile are missing.
2. `tests/runtime/vercel-deployment.test.mjs`
   - Adds a realistic dotfile-less checkout regression.
   - Verifies `--vercel` passes with warnings; `--strict` fails; missing required migration still blocks.

There are **no GitHub Actions workflows** in this patch. The deployment remains Vercel-only with the existing `vercel.json` configuration.

## Apply and redeploy

**Recommended (Git CLI / GitHub Desktop):**

1. Extract `CellFlow_Vercel_Preflight_Hotfix_PATCH.zip`.
2. Copy its `scripts/release-preflight.mjs` and `tests/runtime/vercel-deployment.test.mjs` to the same paths in your CellFlow repository, replacing the existing files. `VERCEL_PREFLIGHT_HOTFIX_2026-10-14.md` is optional documentation.
3. Commit and push to `main`. Do not upload the ZIP itself as one GitHub file.
4. In Vercel, trigger **Redeploy** of the **new** commit (not `059244f`). Node 22.x remains the intended runtime because `package.json` requests Node >=22 <23.
5. Check build output. `release:vercel` should now print `readyForVercelDeployment: true`, `blockers: []`, and warnings for missing dotfiles/lockfile, then continue to typecheck and build.

**If editing via the GitHub website:** open each existing file at its path, click Edit, replace its contents with the corresponding file from the patch, and commit each change. You do not need to upload any hidden file for this fix.

## Run checks locally (optional)

```bash
node scripts/release-preflight.mjs --vercel
node --test tests/runtime/vercel-deployment.test.mjs
node --test tests/runtime/ckb-rbf-candidate-hardening.test.mjs
```

The full `npm run ci:vercel` requires installed npm dependencies, so its TypeScript and Next.js build phases must be verified by the new Vercel deployment. This hotfix fixes **the specific preflight failure reported**, not any possible error later in the pipeline.

## Remaining release hygiene

For a reproducible clean install, generate and commit a genuine `package-lock.json` using Node 22 / npm 10 on a network-enabled developer machine:

```bash
npm install --package-lock-only --ignore-scripts
npm ci
npm run release:check
```

If you want `release:check` to pass as a *strict source-release gate*, also add the four dotfiles to Git. Note that GitHub's file uploader may omit hidden files when selecting a folder. You can use Git CLI or GitHub **Add file → Create new file** to create them deliberately. Do not commit `.env.local`, secrets, wallet keys, or actual `.env` files.

Vercel environment variables (`DATABASE_URL`, `CKB_RPC_URL`, `CELLFLOW_ENCRYPTION_KEY`, etc.) must be configured in Project Settings, not copied into `.env.example` in Git. Their runtime readiness is checked separately by `/api/ready`.
