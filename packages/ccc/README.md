# `@cellflow/ccc`

CCC integration for the failure window CellFlow is designed to solve.

```ts
import { createCellFlow, prepareTrackedTransaction } from "@cellflow/ccc";

const flow = createCellFlow({
  endpoint: process.env.CELLFLOW_URL!,
  apiKey: process.env.CELLFLOW_API_KEY!,
});

const tracked = await prepareTrackedTransaction({
  signer,
  transaction: tx,
  flow,
  intentId: `service-transfer:${orderId}`,
  // Mark stateful application Cells explicitly. CCC-added capacity inputs are
  // then persisted as WALLET_FUNDING for role-aware recovery.
  applicationInputs: [serviceStateOutPoint],
  expectedCells: [{ outputIndex: 0, lock: { args: bobLockArgs } }],
});

console.log("known before broadcast", tracked.txHash);
await tracked.broadcast();
const finalState = await flow.wait(`service-transfer:${orderId}`, { until: "confirmed" });
```

`prepareTrackedTransaction()` asks CCC to prepare/sign the transaction and calls `Transaction.hash()` before `sendTransaction()`. The hash and exact input roles are persisted first. Pre-existing inputs that are not explicitly marked remain `OTHER`; inputs added by CCC during signing/completion are `WALLET_FUNDING`. Rebuilds can reuse the same business `intentId` with `attemptKind: "REBUILD"` so every signed hash remains auditable. CellFlow will not switch away from an attempt that may still commit; RBF eviction is observed through reconciliation rather than used as permission to abandon a live attempt. If broadcast throws after the node may already have accepted the transaction, the adapter records `SUBMISSION_UNKNOWN` and raises `AmbiguousSubmissionError`; it does not automatically rebroadcast.

This package never requests or stores a private key. Signing remains inside the application's CCC signer/wallet boundary.
