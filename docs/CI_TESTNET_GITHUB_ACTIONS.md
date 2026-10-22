# CellFlow — one GitHub Actions workflow for CI and real Pudge testnet proof

**Workflow:** `.github/workflows/ci.yml` (the ONLY workflow in this distribution).

- Every push to `main` and every pull request automatically runs the **CI** job: Node 22, typecheck, deterministic tests and build. No private keys or transaction broadcasts are available to this job.
- **Actions → CellFlow CI + Real CKB Testnet → Run workflow** on `main` automatically runs CI, then, if `run_live_testnet=true`, runs a protected `testnet` job. Set the input to `false` to run only CI.
- The live job uses an `ckb-testnet` Environment, a wallet-spend concurrency lock, strict chain/deployment identity verification and **actual real broadcasts**. Failed or unfunded runs do not count as passed testnet evidence.

## Dedicated, public faucet addresses (already hard-coded in YAML)

| Wallet | CKB Pudge TESTNET address | Minimum balance |
| --- | --- | --- |
| A | `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqf5wntu74dvvhydys0ekc5nmta27q7ed7g03qw8c` | 250 testnet CKB |
| B | `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqdf72483m8lkuvgn50752jw69ny6ywagwgnzqtwj` | 250 testnet CKB |

Use the [official faucet](https://faucet.nervos.org/) and paste only the **public** `ckt1...` addresses. Neither address was funded when generated. The 250-CKB threshold is the runner's minimum; extra testnet CKB is useful for repeat runs. These wallets are only for CKB **testnet** and must never be reused for mainnet.

The corresponding randomly generated private keys were supplied separately to the user in `CellFlow_TESTNET_SECRETS_DO_NOT_UPLOAD.txt` **outside the code ZIP**. Treat that file as sensitive: it grants full control of these testnet wallets. Do not commit, forward, upload or paste it into GitHub. Copy the two secret *values* into GitHub's protected environment; then securely delete unneeded copies. If the file is exposed or you want production-grade key custody, generate two new wallet keys locally and update BOTH hard-coded public addresses in `ci.yml` to match. No one else can recover the private keys from the public address alone.

## Create the protected `ckb-testnet` Environment

On GitHub: **Settings → Environments → New environment → `ckb-testnet`**. Restrict deployments to `main` and, preferably, require approval.

**Environment secrets** (three values):

| Name | What to set |
| --- | --- |
| `CKB_TESTNET_PRIVATE_KEY_A` | The private-key hex from the separately supplied secrets file, NOT the `ckt1...` address. |
| `CKB_TESTNET_PRIVATE_KEY_B` | The different private-key hex for B. |
| `CELLFLOW_TESTNET_API_KEY` | A valid dedicated `cf_live_...` key from the deployed CellFlow test project. |

**Environment variables** (these are not secret):

| Name | What to set |
| --- | --- |
| `CELLFLOW_URL` | Deployed CellFlow URL (default `https://cellflow-brown.vercel.app`). |
| `CELLFLOW_DEPLOYED_SHA` | The actual deployed backend's full 40-character release SHA from `/api/ready`; not necessarily the latest GitHub commit. |
| `CKB_TESTNET_GENESIS_HASH` | Verified CKB testnet genesis hash (one `0x` plus 64 hex chars). |
| `CKB_RPC_URL` | Primary HTTPS Pudge Testnet CKB node (default `https://testnet.ckbapp.dev/rpc`). |
| `CKB_RPC_FALLBACK_URLS` | Independent HTTPS CKB testnet node (default `https://testnet.ckb.dev/`). |

To obtain genesis from an RPC node, query both endpoints and verify `ckb_testnet`:

```sh
curl -sS -H 'content-type: application/json' --data '{"id":1,"jsonrpc":"2.0","method":"get_blockchain_info","params":[]}' https://testnet.ckb.dev/
curl -sS -H 'content-type: application/json' --data '{"id":2,"jsonrpc":"2.0","method":"get_block_hash","params":["0x0"]}' https://testnet.ckb.dev/
```

A mismatched GitHub signing secret fails **before** funding/spending: the live harness derives both addresses with `@ckb-ccc/core` and compares them to the two pinned public addresses. The workflow never prints private keys.

## Run the workflow

1. Apply the patch, including script changes; delete the obsolete `.github/workflows/testnet-live.yml` file if it exists in the repository. Retain only `.github/workflows/ci.yml`.
2. Generate and commit a genuine `package-lock.json` on a network-connected machine with `npm install --package-lock-only`; CI otherwise falls back to `npm install`.
3. Create the protected Environment and configure all five variables / three secrets above. Obtain the dedicated API key from your running CellFlow backend.
4. Request testnet funds for both public addresses at `https://faucet.nervos.org/`, and wait until they are confirmed.
5. In GitHub **Actions → CellFlow CI + Real CKB Testnet → Run workflow** (branch `main`), leave `run_live_testnet` checked.

The protected **testnet** job will execute four tests: two-wallet same-fee contention, strict higher-fee RBF, wallet-input double-spend, and ambiguous broadcast/reconciliation. For a PASS it must see committed transactions from real independent CKB testnet RPC nodes and verify the redacted, checksummed evidence bundle. RBF support depends on node policy and may fail; the workflow must not silently report success without real proof.

Artifacts:

- `cellflow-testnet-status-<run_id>`: sanitized status report and public faucet addresses, even if a preflight or funding gate fails; does **not** prove a PASS.
- `cellflow-testnet-verified-<run_id>`: only published after all live scenarios succeed and redacted evidence is verified.

**Important:** Do not interpret successful CI, a valid address, or a faucet funding event as real end-to-end transaction verification. This workflow has not yet been executed against your deployed service because the live credentials and funded wallets are not available here.
