# Vercel-only reviewer validation and automation

This project does not require GitHub Actions. See [`VERCEL_ONLY_SETUP.md`](../../VERCEL_ONLY_SETUP.md).

- **Install:** `node scripts/vercel-install.mjs` uses `npm ci` with a valid lockfile and `npm install` when bootstrapping without one.
- **Build:** `npm run ci:vercel` runs Vercel preflight, deterministic regressions, TypeScript and Next.js production build. No private Testnet wallet is needed.
- **Maintenance:** `vercel.json` schedules `/api/internal/maintenance` daily on Hobby; Vercel Workflows handle normal reconciliation. Pro installations may use a five-minute repair sweep.
- **Hosted release identity:** use `npm run verify:deployment -- https://cellflow-brown.vercel.app <40-character-sha>`.
- **Real Testnet evidence:** run `npm run validate:testnet-live` explicitly outside the hosted service with dedicated funded Testnet-only wallets. Preserve the non-custodial boundary.
- **PostgreSQL tests and migrations:** run against a separate test/staging DB, not unconditionally during a build.

The bootstrap install fallback is temporary: generate and commit a genuine npm lockfile when a registry-connected development machine is available.
