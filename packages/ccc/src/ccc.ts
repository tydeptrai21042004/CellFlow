import { ccc } from "@ckb-ccc/core";
import type { OutPointRef, SubmissionFailureEvidence } from "@cellflow/core";
import { CellFlowClient } from "./client.ts";
import { classifyBroadcastError } from "./broadcast-errors.ts";

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

export class NodeRejectedError extends Error {
  constructor(
    message: string,
    public readonly intentId: string,
    public readonly txHash: string,
    public readonly evidence: SubmissionFailureEvidence,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NodeRejectedError";
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
  inputOutPoints: OutPointRef[];
  broadcast(): Promise<ccc.Hex>;
}

function parseOutPointIndex(value: unknown): number {
  let parsed: bigint;
  try {
    if (typeof value === "bigint") parsed = value;
    else if (typeof value === "number" && Number.isInteger(value)) parsed = BigInt(value);
    else if (typeof value === "string" && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) parsed = BigInt(value);
    else parsed = BigInt(String(value));
  } catch {
    throw new TypeError("CCC transaction contains an invalid input OutPoint index");
  }
  if (parsed < 0n || parsed > 0xffffffffn) {
    throw new RangeError("CCC transaction input OutPoint index is outside uint32 range");
  }
  return Number(parsed);
}

export function extractInputOutPoints(transaction: ccc.Transaction): OutPointRef[] {
  return transaction.inputs.map((input) => {
    const previousOutput = input.previousOutput;
    const txHash = String(previousOutput.txHash).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
      throw new TypeError("CCC transaction contains an invalid input OutPoint transaction hash");
    }
    return {
      txHash,
      index: parseOutPointIndex(previousOutput.index),
    };
  });
}

export async function prepareTrackedTransaction(
  options: PrepareTrackedTransactionOptions,
): Promise<PreparedTrackedTransaction> {
  // signTransaction performs the signer preparation flow itself. Calling
  // prepareTransaction first and then signTransaction can prepare twice.
  const signed = await options.signer.signTransaction(options.transaction);
  // CKB transaction identity excludes witnesses. Persist both identity and the
  // exact original inputs before any broadcast so later reconciliation can tell
  // submission ambiguity from an input race.
  const txHash = signed.hash();
  const inputOutPoints = extractInputOutPoints(signed);

  await options.flow.prepare({
    intentId: options.intentId,
    txHash,
    inputOutPoints,
    metadata: options.metadata ?? {},
    expectedCells: options.expectedCells ?? [],
  });

  return {
    transaction: signed,
    txHash,
    inputOutPoints,
    async broadcast(): Promise<ccc.Hex> {
      // Fail closed before broadcast if any persisted input is stale, already
      // consumed, or currently unavailable under tx-pool-aware inspection.
      await options.flow.preflight(options.intentId);

      // A persistence/preflight failure before this point is not an ambiguous broadcast.
      await options.flow.markBroadcasting(options.intentId);

      let returnedHash: ccc.Hex;
      try {
        returnedHash = await options.signer.client.sendTransaction(signed);
      } catch (error) {
        const classified = classifyBroadcastError(error);
        if (classified.outcome === "NODE_REJECTED") {
          // An RBF/dead-input-looking error is only a suspicion at this stage.
          // Session 2 will inspect the original OutPoints directly before making
          // any canonical INPUT_SPENT claim.
          await options.flow
            .markNodeRejected(options.intentId, classified.evidence)
            .catch(() => undefined);
          throw new NodeRejectedError(
            "CKB RPC explicitly rejected the transaction; CellFlow recorded submission-layer evidence and will not treat it as an ambiguous send",
            options.intentId,
            txHash,
            classified.evidence,
            error,
          );
        }

        // Do not rebroadcast automatically. The node may have accepted the transaction
        // before the connection failed; reconciliation must check txHash first.
        await options.flow
          .markAmbiguous(options.intentId, classified.evidence)
          .catch(() => undefined);
        throw new AmbiguousSubmissionError(
          "Broadcast outcome is ambiguous; CellFlow will reconcile by deterministic tx hash before any retry",
          options.intentId,
          txHash,
          error,
        );
      }

      if (returnedHash.toLowerCase() !== txHash.toLowerCase()) {
        const evidence: SubmissionFailureEvidence = {
          errorType: "HASH_MISMATCH",
          errorMessage: "CKB RPC returned a transaction hash different from the precomputed hash",
          details: { returnedHash },
        };
        await options.flow.markAmbiguous(options.intentId, evidence).catch(() => undefined);
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
