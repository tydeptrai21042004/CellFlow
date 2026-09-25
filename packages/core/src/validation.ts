import { CellFlowError } from "./errors.ts";

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
