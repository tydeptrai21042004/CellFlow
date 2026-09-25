export interface RpcScript {
  code_hash: string;
  hash_type: string;
  args: string;
}

export interface RpcCellOutput {
  capacity: string;
  lock: RpcScript;
  type?: RpcScript | null;
}

export interface RpcTransactionLike {
  outputs: RpcCellOutput[];
  outputs_data: string[];
}

export interface RpcLiveCellLike {
  status: string;
  cell?: {
    output: RpcCellOutput;
    data?: { content?: string; hash?: string } | string | null;
  } | null;
}

export interface ScriptAssertion {
  codeHash?: string;
  hashType?: string;
  args?: string;
}

export interface ExpectedCellAssertion {
  outputIndex: number;
  mode?: "created" | "live";
  capacity?: string;
  lock?: ScriptAssertion;
  type?: ScriptAssertion | null;
  data?: string;
}

export interface AssertionCheck {
  field: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
}

export interface AssertionResult {
  ok: boolean;
  outputIndex: number;
  mode: "created" | "live";
  checks: AssertionCheck[];
}

function normalizeIntegerHex(value: string): bigint | null {
  try {
    if (!/^0x[0-9a-f]+$/i.test(value)) return null;
    return BigInt(value);
  } catch {
    return null;
  }
}

function hexEq(a: string | undefined | null, b: string | undefined | null): boolean {
  if (a == null || b == null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

function integerHexEq(a: string, b: string): boolean {
  const left = normalizeIntegerHex(a);
  const right = normalizeIntegerHex(b);
  return left !== null && right !== null ? left === right : hexEq(a, b);
}

function scriptChecks(
  prefix: "lock" | "type",
  expected: ScriptAssertion,
  actual: RpcScript | null | undefined,
): AssertionCheck[] {
  const checks: AssertionCheck[] = [];
  if (expected.codeHash !== undefined) {
    checks.push({
      field: `${prefix}.codeHash`, expected: expected.codeHash,
      actual: actual?.code_hash ?? null, ok: hexEq(expected.codeHash, actual?.code_hash),
    });
  }
  if (expected.hashType !== undefined) {
    checks.push({
      field: `${prefix}.hashType`, expected: expected.hashType,
      actual: actual?.hash_type ?? null, ok: expected.hashType === actual?.hash_type,
    });
  }
  if (expected.args !== undefined) {
    checks.push({
      field: `${prefix}.args`, expected: expected.args,
      actual: actual?.args ?? null, ok: hexEq(expected.args, actual?.args),
    });
  }
  return checks;
}

export function assertionHasChecks(assertion: ExpectedCellAssertion): boolean {
  return assertion.capacity !== undefined || assertion.lock !== undefined ||
    assertion.type !== undefined || assertion.data !== undefined;
}

export function verifyCellOutput(
  output: RpcCellOutput | null | undefined,
  data: string | null | undefined,
  assertion: ExpectedCellAssertion,
  mode: "created" | "live" = assertion.mode ?? "created",
): AssertionResult {
  if (!output) {
    return {
      ok: false,
      outputIndex: assertion.outputIndex,
      mode,
      checks: [{ field: "outputIndex", expected: assertion.outputIndex, actual: null, ok: false }],
    };
  }
  if (!assertionHasChecks(assertion)) {
    return {
      ok: false,
      outputIndex: assertion.outputIndex,
      mode,
      checks: [{ field: "assertion", expected: "at least one Cell field check", actual: "empty", ok: false }],
    };
  }

  const checks: AssertionCheck[] = [];
  if (assertion.capacity !== undefined) {
    checks.push({
      field: "capacity", expected: assertion.capacity, actual: output.capacity,
      ok: integerHexEq(assertion.capacity, output.capacity),
    });
  }
  if (assertion.lock) checks.push(...scriptChecks("lock", assertion.lock, output.lock));
  if (assertion.type === null) {
    checks.push({ field: "type", expected: null, actual: output.type ?? null, ok: output.type == null });
  } else if (assertion.type) {
    checks.push(...scriptChecks("type", assertion.type, output.type));
  }
  if (assertion.data !== undefined) {
    checks.push({ field: "data", expected: assertion.data, actual: data ?? null, ok: hexEq(assertion.data, data) });
  }

  return { ok: checks.length > 0 && checks.every((check) => check.ok), outputIndex: assertion.outputIndex, mode, checks };
}

export function verifyExpectedCell(
  transaction: RpcTransactionLike,
  assertion: ExpectedCellAssertion,
): AssertionResult {
  return verifyCellOutput(
    transaction.outputs[assertion.outputIndex],
    transaction.outputs_data[assertion.outputIndex],
    assertion,
    "created",
  );
}

export function verifyExpectedCells(
  transaction: RpcTransactionLike,
  assertions: ExpectedCellAssertion[],
): AssertionResult[] {
  return assertions.map((assertion) => verifyExpectedCell(transaction, assertion));
}

export function verifyLiveCell(
  liveCell: RpcLiveCellLike | null,
  assertion: ExpectedCellAssertion,
): AssertionResult {
  if (!liveCell || liveCell.status !== "live" || !liveCell.cell) {
    return {
      ok: false,
      outputIndex: assertion.outputIndex,
      mode: "live",
      checks: [{ field: "live", expected: true, actual: liveCell?.status ?? null, ok: false }],
    };
  }
  const dataValue = typeof liveCell.cell.data === "string"
    ? liveCell.cell.data
    : liveCell.cell.data?.content ?? null;
  return verifyCellOutput(liveCell.cell.output, dataValue, assertion, "live");
}
