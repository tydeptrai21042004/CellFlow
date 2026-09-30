import { ccc } from "@ckb-ccc/core";
import { signedPayloadFingerprintSha256, type AttemptKind, type InputRef, type OutPointRef, type SubmissionFailureEvidence } from "@cellflow/core";
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
  /** Explicit semantic roles take precedence over all role inference. */
  inputRefs?: InputRef[];
  /** Inputs owned by application state before CCC adds wallet/funding capacity. */
  applicationInputs?: OutPointRef[];
  attemptKind?: AttemptKind;
  parentAttemptId?: string | null;
}

export interface PreparedTrackedTransaction {
  transaction: ccc.Transaction;
  txHash: ccc.Hex;
  inputOutPoints: OutPointRef[];
  inputRefs: InputRef[];
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

function outPointKey(outPoint: OutPointRef): string {
  return `${outPoint.txHash.toLowerCase()}:${outPoint.index}`;
}

export function classifyInputRefs(
  inputOutPoints: OutPointRef[],
  explicitInputRefs: InputRef[] = [],
  applicationInputs: OutPointRef[] = [],
  originalInputs: OutPointRef[] = [],
): InputRef[] {
  const finalInputs = new Set(inputOutPoints.map(outPointKey));
  const explicit = new Map<string, InputRef>();
  for (const ref of explicitInputRefs) {
    const key = outPointKey(ref.outPoint);
    if (!finalInputs.has(key)) {
      throw new TypeError(`Explicit inputRef ${key} does not exist in the final signed transaction`);
    }
    if (explicit.has(key)) {
      throw new TypeError(`Duplicate explicit inputRef for ${key}`);
    }
    explicit.set(key, ref);
  }
  const application = new Set(applicationInputs.map(outPointKey));
  const original = new Set(originalInputs.map(outPointKey));
  return inputOutPoints.map((outPoint) => {
    const key = outPointKey(outPoint);
    const declared = explicit.get(key);
    if (declared) return { ...declared, outPoint };
    return {
      outPoint,
      role: application.has(key)
        ? "APPLICATION_STATE"
        : original.has(key)
          ? "OTHER"
          : "WALLET_FUNDING",
    };
  });
}

export async function prepareTrackedTransaction(
  options: PrepareTrackedTransactionOptions,
): Promise<PreparedTrackedTransaction> {
  // Capture inputs that existed before the signer preparation flow. Inputs added
  // by CCC afterwards are wallet/funding inputs; pre-existing inputs remain OTHER
  // unless the caller explicitly marks them as application state.
  const originalInputs = extractInputOutPoints(options.transaction);

  // signTransaction performs the signer preparation flow itself. Calling
  // prepareTransaction first and then signTransaction can prepare twice.
  // CCC 1.19.x accepts TransactionLike here. With exactOptionalPropertyTypes,
  // the concrete Transaction class is not structurally assignable because its
  // cached/optional CellInput metadata includes explicit `undefined` in the
  // class type. Runtime-wise this is the exact CCC Transaction instance the
  // signer expects, so keep the object unchanged and isolate the compatibility
  // cast at the library boundary instead of weakening project-wide TS checks.
  const signed = await options.signer.signTransaction(
    options.transaction as unknown as Parameters<ccc.Signer["signTransaction"]>[0],
  );
  // CKB transaction identity excludes witnesses. Persist both identity and the
  // exact original inputs before any broadcast so later reconciliation can tell
  // submission ambiguity from an input race.
  const txHash = signed.hash();
  const signedPayloadHashSha256 = await signedPayloadFingerprintSha256(signed);
  if (!signedPayloadHashSha256) {
    throw new TypeError("Unable to fingerprint the complete signed CKB transaction payload");
  }
  const inputOutPoints = extractInputOutPoints(signed);
  const inputRefs = classifyInputRefs(
    inputOutPoints,
    options.inputRefs ?? [],
    options.applicationInputs ?? [],
    originalInputs,
  );

  await options.flow.prepare({
    intentId: options.intentId,
    txHash,
    signedPayloadHashSha256,
    inputOutPoints,
    inputRefs,
    metadata: options.metadata ?? {},
    expectedCells: options.expectedCells ?? [],
    ...(options.attemptKind ? { attemptKind: options.attemptKind } : {}),
    ...(options.parentAttemptId !== undefined ? { parentAttemptId: options.parentAttemptId } : {}),
  });

  return {
    transaction: signed,
    txHash,
    inputOutPoints,
    inputRefs,
    async broadcast(): Promise<ccc.Hex> {
      // Fail closed before broadcast if any persisted input is stale, already
      // consumed, or currently unavailable under tx-pool-aware inspection.
      await options.flow.preflight(options.intentId);

      // A persistence/preflight failure before this point is not an ambiguous broadcast.
      await options.flow.markBroadcasting(options.intentId);

      let returnedHash: ccc.Hex;
      try {
        returnedHash = await options.signer.client.sendTransaction(
          signed as unknown as Parameters<typeof options.signer.client.sendTransaction>[0],
        );
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
