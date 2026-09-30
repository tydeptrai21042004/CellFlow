# Real CKB Testnet evidence harness

This harness converts CellFlow's reviewer-facing edge cases into repeatable, real CKB Testnet experiments.

## What a strict green run proves

`npm run validate:testnet-live` performs deterministic regressions first, then real Testnet experiments:

1. **Two-wallet application-state contention at equal fee rate.** A shared `AlwaysSuccess` application-state Cell is created on Testnet. Wallet A and wallet B build different transitions that consume the same application Cell. The losing submission is expected to be rejected/contended and, after the contention grace window, CellFlow must resolve the application input as spent and recommend rebuilding from live application state.
2. **Two-wallet higher-fee replacement.** A fresh shared application Cell is raced again with a low-fee attempt and a higher-fee competing attempt. Strict mode requires the higher-fee attempt to be accepted, the low attempt to become terminal from canonical input-spend evidence, and the winning hash to be persisted as an `RBF_REPLACEMENT` attempt under the same business intent.
3. **Wallet-only stale-input race.** Two transactions consume the same wallet-owned Cell. The loser must resolve to `INPUT_SPENT` with `RECOLLECT_WALLET_INPUTS`, proving that wallet and application conflicts lead to different recovery actions.
4. **Ambiguous submission recovery.** A transaction is really accepted by Testnet, then the harness intentionally discards the successful response and persists `SUBMISSION_UNKNOWN`. A fresh Node.js process reconciles the persisted deterministic hash until confirmation and live-Cell verification.
5. **Signed-payload and Cell evidence.** Persisted intent evidence must contain the full signed-payload fingerprint and live-Cell/canonical chain evidence.
6. **Multi-RPC provenance.** At least two Testnet RPC endpoints are identity-checked and queried for transaction evidence.

The ambiguous scenario is explicit fault injection after a real accepted Testnet broadcast; it does not pretend a natural TCP failure occurred. A public-network reorg is not intentionally induced.

## Setup

The harness now has safe defaults for the hosted URL, Testnet RPCs, evidence policy, fee rates, timeouts, and two **public Testnet-only development signers**. You do not need to create or paste separate CKB keys for the default run. Never fund those default identities with Mainnet CKB or reuse them outside Testnet validation.

For CellFlow authentication, no duplicate `CELLFLOW_API_KEY` is required when your normal local environment already contains either `CELLFLOW_INITIAL_ADMIN_API_KEY` or `CELLFLOW_BOOTSTRAP_TOKEN`. The runner loads `.env`, `.env.local`, `.env.production.local`, and `.env.testnet.local` automatically and reuses/derives the same initial admin credential that automatic bootstrap uses. You can still override it with a dedicated scoped `CELLFLOW_API_KEY`.

Optional overrides can be copied from the template:

```bash
cp .env.testnet.example .env.testnet.local
```

The harness refuses non-Testnet signer/network behavior and verifies every configured RPC reports `ckb_testnet` with the same genesis hash.

Fund the two resulting `ckt1...` addresses. Each wallet should have at least the configured `CELLFLOW_TESTNET_MIN_BALANCE_CKB` (250 CKB by default). Runs primarily consume Testnet transaction fees.

## Run

```bash
npm run validate:testnet-live
```

A non-zero exit means at least one required live scenario was not demonstrated. Do not present that run as complete reviewer evidence.

## Evidence bundle

Artifacts are written under `CELLFLOW_EVIDENCE_DIR` or `evidence/testnet/live/<run-id>/` and include:

- Testnet/genesis/RPC identity observations;
- public wallet addresses and starting balances (never private keys);
- real transaction hashes and direct RPC observations;
- same-fee contention evidence before and after the grace period;
- higher-fee RBF/replacement evidence and attempt linkage;
- wallet-input conflict evidence;
- new-process ambiguous recovery trace;
- persisted CellFlow intent/project evidence;
- `SHA256SUMS` for artifact integrity;
- final pass/fail summary.

The evidence bundle never writes `CKB_TESTNET_PRIVATE_KEY_A`, `CKB_TESTNET_PRIVATE_KEY_B`, or `CELLFLOW_API_KEY`.
