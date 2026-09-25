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

export class TrackingUpdateError extends Error {
  constructor(
    message: string,
    public readonly intentId: string,
    public readonly txHash: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrackingUpdateError";
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
  // signTransaction performs the signer preparation flow itself. Calling
  // prepareTransaction first and then signTransaction can prepare twice.
  const signed = await options.signer.signTransaction(options.transaction);
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
      // A persistence failure before this point is not an ambiguous broadcast.
      await options.flow.markBroadcasting(options.intentId);

      let returnedHash: ccc.Hex;
      try {
        returnedHash = await options.signer.client.sendTransaction(signed);
      } catch (error) {
        // Do not rebroadcast automatically. The node may have accepted the transaction
        // before the connection failed; reconciliation must check txHash first.
        await options.flow.markAmbiguous(options.intentId).catch(() => undefined);
        throw new AmbiguousSubmissionError(
          "Broadcast outcome is ambiguous; CellFlow will reconcile by deterministic tx hash before any retry",
          options.intentId,
          txHash,
          error,
        );
      }

      if (returnedHash.toLowerCase() !== txHash.toLowerCase()) {
        await options.flow.markAmbiguous(options.intentId).catch(() => undefined);
        throw new AmbiguousSubmissionError(
          "CKB RPC returned a transaction hash different from the precomputed hash",
          options.intentId,
          txHash,
        );
      }

      try {
        await options.flow.markSubmitted(options.intentId);
      } catch (error) {
        // Broadcasting is known to have succeeded. This is bookkeeping uncertainty,
        // not broadcast uncertainty; callers should not rebroadcast.
        throw new TrackingUpdateError(
          "Transaction broadcast succeeded but CellFlow could not persist SUBMITTED; reconcile the persisted txHash",
          options.intentId,
          txHash,
          error,
        );
      }
      return returnedHash;
    },
  };
}
