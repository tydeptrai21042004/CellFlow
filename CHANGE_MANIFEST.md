# CellFlow compared patch

Compared against the uploaded `CellFlow-main.zip` on 2026-10-02.

This overlay contains only the files that need to be added/replaced to bring the uploaded repository up to the consolidated Testnet evidence runner used in this conversation. It intentionally excludes `.env.testnet.local` and all real credentials.

## Replace existing files

- `packages/ccc/src/client.ts` — retry transport-level Vercel/CellFlow fetch failures without retrying authoritative HTTP/API errors; optional timeout.
- `run_testnet_local_all.sh` — literal env parser, inherited env precedence, duplicate warnings, credential/database validation, WSL IPv4 preference, resumable/fresh evidence directory logic, cached dependency/CI stages.
- `scripts/evidence/testnet-live-reconcile-worker.mjs` — HTTP transport retry configuration and IPv4-first handling.
- `scripts/evidence/testnet-live-suite.mjs` — CCC 1.19.1 compatibility, RPC retry/failover, scenario resume, wallet seed retry, explicit `WALLET_FUNDING` input role, resilient Testnet/Vercel requests.
- `scripts/evidence/testnet-preflight.mjs` — IPv4-first/reliable Testnet preflight behavior.
- `scripts/run-testnet-live-evidence.sh` — safe env loading, stage markers, preflight retry/diagnostics, resume support.
- `tests/runtime/testnet-live-harness.test.mjs` — regressions covering all of the above behavior.

## Add new files

- `.env.testnet.example` — clean secret-free Testnet configuration template.
- `.gitignore` — keeps local Testnet env/evidence secrets and generated state out of Git.
- `generate_cellflow_testnet_wallets.sh` — generates fresh Testnet-only private keys locally, derives faucet `ckt1...` addresses, updates `.env.testnet.local`, validates funding.
- `setup_testnet_and_run.sh` — one-command fresh-wallet -> faucet -> balance-check -> clean evidence workflow.

## Not deleted

The uploaded repository's `LOCAL_TESTNET_CHANGELOG.md` and `LOCAL_TESTNET_RUN.md` are left untouched because they are local documentation and do not conflict with runtime behavior.

## Apply

From the repository root, extract this ZIP over the project root, or copy the contained files while preserving paths. Then run:

```bash
chmod +x run_testnet_local_all.sh generate_cellflow_testnet_wallets.sh setup_testnet_and_run.sh scripts/run-testnet-live-evidence.sh
./setup_testnet_and_run.sh
```

For an existing funded wallet configuration, use:

```bash
./run_testnet_local_all.sh --resume
```

Use `--fresh` when creating the final evidence bundle with newly generated wallets.
