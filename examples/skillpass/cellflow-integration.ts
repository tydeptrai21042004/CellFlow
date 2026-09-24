import { createCellFlow, prepareTrackedTransaction } from "@cellflow/ccc";
import type { ccc } from "@ckb-ccc/core";

/**
 * Example: SkillPass transfer Alice -> Bob.
 * Build the transaction with SkillPass's existing rules, then let CellFlow own
 * durable lifecycle/recovery. No SkillPass entitlement rule moves into CellFlow.
 */
export async function transferSkillPass(args: {
  signer: ccc.Signer;
  transaction: ccc.Transaction;
  passId: string;
  bobLockArgs: string;
}) {
  const flow = createCellFlow({
    endpoint: process.env.CELLFLOW_URL!,
    apiKey: process.env.CELLFLOW_API_KEY!,
  });

  const intentId = `skillpass:transfer:${args.passId}:${args.bobLockArgs}`;
  const prepared = await prepareTrackedTransaction({
    signer: args.signer,
    transaction: args.transaction,
    flow,
    intentId,
    metadata: { kind: "skillpass_transfer", passId: args.passId },
    expectedCells: [
      {
        outputIndex: 0,
        lock: { args: args.bobLockArgs },
      },
    ],
  });

  // The deterministic hash has already been saved to CellFlow at this point.
  await prepared.broadcast();
  return flow.wait(intentId, { until: "confirmed", timeoutMs: 10 * 60_000 });
}
