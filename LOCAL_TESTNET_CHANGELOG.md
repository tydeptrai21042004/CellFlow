# Local Testnet runner changes

Added for a one-command local/WSL evidence run against the deployed Vercel CellFlow service:

- `.env.testnet.example` — safe committed template; fixes the missing file required by `tests/runtime/testnet-live-harness.test.mjs`.
- `.env.testnet.local` — local configuration copy with the production Vercel URL and Testnet defaults. Replace the `cf_live_...` placeholder, or simply run interactively and paste the key when prompted.
- `run_testnet_local_all.sh` — validates Testnet-only safety, credentials, keys and Node 22; installs dependencies; optionally runs the Vercel CI gate; then executes every live reviewer-evidence scenario and verifies checksums.
- `.gitignore` — prevents local secret environment files and generated live evidence from being committed accidentally.
- `LOCAL_TESTNET_RUN.md` — short usage guide.

Validation performed on this patch:

```text
bash -n run_testnet_local_all.sh                         PASS
node --test tests/runtime/crowdcell-review-final.test.mjs \
  tests/runtime/crowdcell-recovery-upgrade.test.mjs \
  tests/runtime/ckb-edge-hardening.test.mjs \
  tests/runtime/testnet-live-harness.test.mjs            20/20 PASS
```

The real live-Testnet transactions were intentionally not broadcast while building this patch because they require the user's production CellFlow credential and funded Testnet wallets.
