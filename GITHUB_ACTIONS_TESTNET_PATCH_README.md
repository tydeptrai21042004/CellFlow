# CellFlow GitHub Actions + real CKB Testnet patch

This patch is intended to be COPIED OVER the provided `CellFlow-main` project,
with paths relative to the repository root. It is not a standalone npm project.

## Added
- `.github/workflows/ci.yml`: deterministic CI on push/PR
- `.github/workflows/ci.yml`: manual `testnet` job in the SAME YAML; protected real CKB Testnet broadcasts
- `scripts/evidence/ci-testnet-config.mjs`: strict pre-spend configuration gate
- `scripts/evidence/testnet-chain-witness.mjs`: exact on-chain committed tx witness
- `scripts/evidence/github-testnet-summary.mjs`: redacted CI report and job summary
- `tests/runtime/github-testnet-ci.test.mjs`: validation and security regressions
- `docs/CI_TESTNET_GITHUB_ACTIONS.md`: full GitHub secrets, genesis, funding and run guide
- `.env.example`, `.env.testnet.example`, `.nvmrc`, `.gitignore`: missing source-support files from the supplied ZIP

## Modified
- `package.json`: includes `test:ci-testnet` in the deterministic test script
- `scripts/evidence/testnet-live-suite.mjs`: requires matching committed transaction witnesses
- `scripts/run-testnet-live-evidence.sh`: injects secrets only from the CI environment, no env-file sourcing in CI
- `README.md`: links to Actions setup instructions

## Important
A green deterministic CI run is NOT a proof of real Testnet execution.
Real spend-enabled run requires isolated funded wallets, pinned deployed release SHA,
two verified Testnet RPCs, a running CellFlow backend, and protected GitHub
Environment secrets. The live job is deliberately manual-only.

The provided source ZIP did NOT contain `package-lock.json`; this patch does not
fabricate one. Generate the lockfile using `npm run setup:lockfile` while npm
registry access is available; commit it for reproducible CI.

Local offline tests passed: 63 of 63 focused checks.
No CKB transaction has been broadcast by the offline patch preparation.
