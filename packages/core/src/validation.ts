import { CellFlowError } from "./errors.ts";
import type { OutPointRef } from "./types.ts";

export function normalizeTxHash(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new CellFlowError("INVALID_TX_HASH", "Transaction hash must be a 32-byte 0x-prefixed hex value", 400);
  }
  return normalized;
}

export function normalizeIntentId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new CellFlowError(
      "INTENT_CONFLICT",
      "intentId must be 1-128 characters using letters, numbers, . _ : or -",
      400,
    );
  }
  return normalized;
}

export function normalizeOutPointRef(value: OutPointRef): OutPointRef {
  return {
    txHash: normalizeTxHash(value.txHash),
    index: normalizeOutPointIndex(value.index),
  };
}

export function normalizeOutPointRefs(values: OutPointRef[]): OutPointRef[] {
  if (values.length > 1024) {
    throw new CellFlowError("INVALID_SIGNED_TRANSACTION", "A transaction may not persist more than 1024 input OutPoints", 400);
  }
  return values.map(normalizeOutPointRef);
}

function normalizeOutPointIndex(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new CellFlowError("INVALID_SIGNED_TRANSACTION", "Input OutPoint index must be a uint32", 400);
  }
  return value;
}
