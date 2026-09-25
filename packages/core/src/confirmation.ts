import { CellFlowError } from "./errors.ts";
import type { ConfirmationPolicy } from "./types.ts";

export function parseConfirmationPolicy(value?: string): ConfirmationPolicy {
  if (!value || value === "committed") return { mode: "committed" };
  const match = /^depth:(\d+)$/.exec(value);
  if (!match) {
    throw new CellFlowError(
      "INTERNAL_ERROR",
      `Invalid confirmation policy: ${value}`,
      500,
    );
  }
  const blocks = Number(match[1]);
  if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > 10_000) {
    throw new CellFlowError("INTERNAL_ERROR", "Confirmation depth is out of range", 500);
  }
  return { mode: "depth", blocks };
}
