export interface ClassifiedSubmissionFailure {
  errorCode?: string;
  errorType: "TRANSPORT_UNKNOWN" | "RPC_REJECTION" | "HASH_MISMATCH";
  errorMessage?: string;
  conflictType?: "INPUT_CONFLICT_SUSPECTED";
  details?: Record<string, unknown>;
}

const transportPattern = /(?:timeout|timed out|network|fetch failed|connection|econnreset|econnrefused|socket|abort(?:ed|error)?|dns|enotfound|gateway|\b50[234]\b)/i;
const rejectionPattern = /(?:pool.*reject|transaction.*reject|invalid transaction|invalid tx|verification failed|script.*(?:failed|error)|resolve.*failed|unknown out\s*point|dead input|already spent|fee too low|replace(?:ment)?|\brbf\b|unconfirmed input)/i;
const inputConflictPattern = /(?:unknown out\s*point|dead input|already spent|fee too low|replace(?:ment)?|\brbf\b|unconfirmed input|input.*conflict)/i;

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object" ? error as Record<string, unknown> : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 4000);
  const record = errorRecord(error);
  if (record && typeof record.message === "string") return record.message.slice(0, 4000);
  return String(error).slice(0, 4000);
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = errorRecord(current);
    if (!record) break;
    if (typeof record.code === "number" || typeof record.code === "string") {
      return String(record.code).slice(0, 128);
    }
    current = record.cause;
  }
  return undefined;
}

function hasStructuredRpcCode(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = errorRecord(current);
    if (!record) break;
    // JSON-RPC error codes are negative. Positive HTTP status codes such as 502/503
    // must remain ambiguous transport failures unless their message itself proves
    // a deterministic CKB rejection.
    if (typeof record.code === "number" && record.code < 0) return true;
    current = record.cause;
  }
  return false;
}

export function classifyBroadcastError(error: unknown): {
  outcome: "AMBIGUOUS" | "NODE_REJECTED";
  evidence: ClassifiedSubmissionFailure;
} {
  const message = errorMessage(error);
  const code = errorCode(error);
  const record = errorRecord(error);
  const name = error instanceof Error ? error.name : typeof record?.name === "string" ? record.name : undefined;
  const explicitRejection = hasStructuredRpcCode(error) || rejectionPattern.test(message);
  const conflictSuspected = explicitRejection && inputConflictPattern.test(message);

  if (explicitRejection) {
    return {
      outcome: "NODE_REJECTED",
      evidence: {
        ...(code ? { errorCode: code } : {}),
        errorType: "RPC_REJECTION",
        errorMessage: message,
        ...(conflictSuspected ? { conflictType: "INPUT_CONFLICT_SUSPECTED" as const } : {}),
        details: {
          ...(name ? { name } : {}),
          classification: "explicit-node-rejection",
          canonicalSpendConfirmed: false,
        },
      },
    };
  }

  return {
    outcome: "AMBIGUOUS",
    evidence: {
      ...(code ? { errorCode: code } : {}),
      errorType: "TRANSPORT_UNKNOWN",
      errorMessage: message,
      details: {
        ...(name ? { name } : {}),
        classification: transportPattern.test(message) ? "transport-failure" : "unclassified-send-error",
      },
    },
  };
}
