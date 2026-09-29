# CrowdCell review validation

This patch closes the remaining deterministic gaps raised in the CrowdCell feedback:

- submit-time `INPUT_CONFLICT_SUSPECTED` rejection starts reconciliation immediately;
- `MEMPOOL_CONTENDED` records a configurable grace window (`CELLFLOW_CONTENTION_GRACE_MS`, default `30000`);
- the first contention timestamp is preserved across reconciliation passes;
- after grace expiry the recommended recovery is based on the contended input domain:
  - wallet/fee input -> `RECOLLECT_WALLET_INPUTS`;
  - application-state input -> `REBUILD_FROM_LIVE_STATE`;
  - mixed -> `REBUILD_AND_RESIGN`;
- CCC integrations may provide explicit `inputRefs`, which take precedence over heuristics and are validated against the final signed transaction;
- one intent/multiple attempts remains preserved by migration 006 and evidence export.

## One-command validation

Deterministic checks (no wallet GUI, database, or Testnet required):

```bash
bash scripts/validate-crowdcell-review.sh
```

Full local validation, including DB tests when `DATABASE_URL` is available:

```bash
bash scripts/validate-crowdcell-review.sh all
```

Testnet preflight is also included in `all` when `CKB_RPC_URL` is set. The repository intentionally does not automate JoyID/WebAuthn approval or custody wallet keys; real wallet signing remains a user-mediated boundary.

## Real reviewer evidence still requiring external Testnet state

The code can automate reconciliation and evidence capture, but a real two-wallet CrowdCell race still requires funded Testnet inputs / signed transactions. For the strongest reviewer proof, publish an evidence bundle for both equal-fee rejection and higher-fee displacement, including both transaction hashes, the shared application input, RPC observations, and final CellFlow evidence export.
