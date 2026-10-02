# Run CellFlow real-Testnet evidence locally against Vercel

The local machine is only the **external test runner**. CellFlow itself remains the deployed service at `https://cellflow-brown.vercel.app`.

## 1. Configure the credential

Edit `.env.testnet.local` and replace:

```text
CELLFLOW_API_KEY=cf_live_REPLACE_WITH_YOUR_PROJECT_API_KEY
```

with a real project-scoped `cf_live_...` key. Alternatively configure `CELLFLOW_INITIAL_ADMIN_API_KEY` or `CELLFLOW_BOOTSTRAP_TOKEN`.

For a final reviewer run, also put two fresh Testnet-only private keys in `CKB_TESTNET_PRIVATE_KEY_A` and `CKB_TESTNET_PRIVATE_KEY_B`, then fund both corresponding `ckt1...` addresses with at least the configured minimum (250 CKB by default). Leaving the keys blank uses the repository's public development Testnet identities.

## 2. Run everything

From WSL/Linux/macOS:

```bash
chmod +x run_testnet_local_all.sh
./run_testnet_local_all.sh
```

The script:

1. loads `.env.testnet.local`;
2. refuses Mainnet/local HTTP targets and placeholder credentials;
3. checks Node.js 22 and wallet-key formatting;
4. installs dependencies (`npm ci` when a lockfile exists, otherwise `npm install`);
5. runs `npm run ci:vercel` by default;
6. runs `npm run validate:testnet-live` against the deployed Vercel service and real CKB Testnet;
7. verifies `SHA256SUMS` when the live suite succeeds.

Evidence is written to a timestamped directory under `evidence/testnet/live/` unless `CELLFLOW_EVIDENCE_DIR` is explicitly set.

For a faster repeat run after CI already passed, set:

```text
CELLFLOW_LOCAL_RUN_CI=false
```

in `.env.testnet.local`.
