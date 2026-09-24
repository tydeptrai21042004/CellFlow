import { ccc } from "@ckb-ccc/core";
import { CellFlowClient } from "./client.js";

export class AmbiguousSubmissionError extends Error {
  constructor(
    message: string,
    public readonly intentId: string,
    public readonly txHash: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AmbiguousSubmissionError";
  }
}

export interface PrepareTrackedTransactionOptions {
  signer: ccc.Signer;
  transaction: ccc.Transaction;
  flow: CellFlowClient;
  intentId: string;
  metadata?: Record<string, unknown>;
  expectedCells?: unknown[];
}

export interface PreparedTrackedTransaction {
  transaction: ccc.Transaction;
  txHash: ccc.Hex;
  broadcast(): Promise<ccc.Hex>;
}

export async function prepareTrackedTransaction(
  options: PrepareTrackedTransactionOptions,
): Promise<PreparedTrackedTransaction> {
  const prepared = await options.signer.prepareTransaction(options.transaction);
  const signed = await options.signer.signTransaction(prepared);
  // CKB transaction identity excludes witnesses. CCC exposes this deterministically
  // before the broadcast RPC, which closes the ambiguous-submit recovery gap.
  const txHash = signed.hash();

  await options.flow.prepare({
    intentId: options.intentId,
    txHash,
    metadata: options.metadata ?? {},
    expectedCells: options.expectedCells ?? [],
  });

  return {
    transaction: signed,
    txHash,
    async broadcast(): Promise<ccc.Hex> {
      try {
        await options.flow.markBroadcasting(options.intentId);
        const returnedHash = await options.signer.client.sendTransaction(signed);
        if (returnedHash.toLowerCase() !== txHash.toLowerCase()) {
          await options.flow.markAmbiguous(options.intentId);
          throw new AmbiguousSubmissionError(
            "CKB RPC returned a transaction hash different from the precomputed hash",
            options.intentId,
            txHash,
          );
        }
        await options.flow.markSubmitted(options.intentId);
        return returnedHash;
      } catch (error) {
        if (!(error instanceof AmbiguousSubmissionError)) {
          // Do not rebroadcast automatically. The RPC may have accepted the transaction
          // before the connection timed out; CellFlow will reconcile by txHash first.
          await options.flow.markAmbiguous(options.intentId).catch(() => undefined);
        }
        if (error instanceof AmbiguousSubmissionError) throw error;
        throw new AmbiguousSubmissionError(
          "Broadcast outcome is ambiguous; CellFlow will reconcile by deterministic tx hash before any retry",
          options.intentId,
          txHash,
          error,
        );
      }
    },
  };
}
