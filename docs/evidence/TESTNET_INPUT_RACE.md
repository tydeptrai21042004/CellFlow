# CKB Testnet input-race evidence runbook

This runbook produces external evidence for CellFlow's distinction between an ambiguous/lost submission and a transaction that lost a race for a shared input Cell.

## Safety boundary

Use a **testnet-only** wallet and Testnet CKB. Do not store a private key, seed phrase, or signing token in CellFlow environment files. CellFlow persists intent/transaction evidence; transaction construction and signing remain in the consuming application or wallet.

## Environment

```bash
./scripts/cellflow-testnet-setup.sh /path/to/CellFlow-main
set -a
source .env.local
set +a
npm run dev
```

The setup script verifies that `CKB_RPC_URL` reports `ckb_testnet`, derives the expected genesis hash, starts/configures PostgreSQL when needed, and runs repository checks. It does not create a wallet or broadcast a transaction.

## Experiment

1. Fund a testnet-only `ckt...` address and select one live Cell `C0` that can safely be consumed.
2. Construct and sign two different transactions, `Tx A` and `Tx B`, that both consume exactly the same `C0` OutPoint.
3. Create two CellFlow intents and call `/prepare` for each **before** either broadcast. Confirm that each intent records its deterministic `txHash` and the shared `inputOutPoints`.
4. Broadcast `Tx A` first.
5. Attempt to broadcast `Tx B`. Record the exact RPC response. Do not rewrite the transaction or blindly rebroadcast it.
6. Reconcile both intents until `Tx A` reaches a canonical committed state and the original input is no longer canonically live.
7. Export evidence for both intents.

## Acceptable timing outcomes

Public Testnet timing is nondeterministic. The proof does **not** require CellFlow to observe every transient intermediate state. For example, `Tx A` may commit before the first reconciliation of `Tx B`.

The deterministic fake-RPC integration suite proves the complete intermediate path:

```text
MEMPOOL_CONTENDED
  -> INPUT_SPENT_OBSERVED
  -> INPUT_SPENT
  -> CONFLICTED
```

The real Testnet proof should establish the invariant that `Tx B` is not mistaken for a merely lost transaction once canonical input-spend evidence exists, and that CellFlow does not automatically rebuild/sign/rebroadcast it.

## Evidence to retain

Record at minimum:

- Testnet network/genesis identity and RPC endpoint identity.
- Shared input `C0` OutPoint.
- `txHash` for `Tx A` and `Tx B`.
- Exact broadcast outcome for each transaction.
- Observed tip heights and relevant block hashes.
- Input observations, including `liveBlockHash` when the RPC supplies it.
- CellFlow append-only events and final lifecycle states.
- `recommendedAction` for the losing intent.
- Exported evidence JSON plus both `snapshotSha256` and `contentSha256`.

A terminal `INPUT_SPENT` decision is corroborated through a second configured RPC endpoint when more than one endpoint is configured. If corroboration disagrees or is unavailable, CellFlow should remain non-terminal rather than invent certainty.
