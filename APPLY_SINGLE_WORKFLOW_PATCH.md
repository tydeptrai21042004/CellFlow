CellFlow single GitHub Actions workflow patch

1. Extract this ZIP directly over the ROOT of the existing CellFlow repository.
2. IMPORTANT: DELETE the old `.github/workflows/testnet-live.yml` from the repository.
   On a local Git checkout: git rm -f .github/workflows/testnet-live.yml
   You should now have ONLY `.github/workflows/ci.yml`.
3. git add -A && git commit -m "Unify CI and live testnet in one workflow" && git push
4. Configure the protected GitHub environment `ckb-testnet` per docs/CI_TESTNET_GITHUB_ACTIONS.md.
5. Fund the two PUBLIC addresses hard-coded in `.github/workflows/ci.yml`.

Credentials are supplied separately and deliberately EXCLUDED from this ZIP.
Never push the CKB_TESTNET_PRIVATE_KEY_A/B secrets file to any repository.
The public addresses are already pinned in YAML; use the matching two private keys
as GitHub Environment secrets, not repository variables.

This patch preserves the previous evidence harness and adds signer-address pinning.
CI runs automatically on push/pull request; the spend-enabled testnet job only runs
on manual workflow_dispatch from main after CI passes.
