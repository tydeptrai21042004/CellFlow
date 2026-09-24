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

export interface ScriptAssertion {
  codeHash?: string;
  hashType?: string;
  args?: string;
}

export interface ExpectedCellAssertion {
  outputIndex: number;
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
  checks: AssertionCheck[];
}

function hexEq(a: string | undefined | null, b: string | undefined | null): boolean {
  if (a == null || b == null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

function scriptChecks(
  prefix: "lock" | "type",
  expected: ScriptAssertion,
  actual: RpcScript | null | undefined,
): AssertionCheck[] {
  const checks: AssertionCheck[] = [];
  if (expected.codeHash !== undefined) {
    checks.push({
      field: `${prefix}.codeHash`,
      expected: expected.codeHash,
      actual: actual?.code_hash ?? null,
      ok: hexEq(expected.codeHash, actual?.code_hash),
    });
  }
  if (expected.hashType !== undefined) {
    checks.push({
      field: `${prefix}.hashType`,
      expected: expected.hashType,
      actual: actual?.hash_type ?? null,
      ok: expected.hashType === actual?.hash_type,
    });
  }
  if (expected.args !== undefined) {
    checks.push({
      field: `${prefix}.args`,
      expected: expected.args,
      actual: actual?.args ?? null,
      ok: hexEq(expected.args, actual?.args),
    });
  }
  return checks;
}

export function verifyExpectedCell(
  transaction: RpcTransactionLike,
  assertion: ExpectedCellAssertion,
): AssertionResult {
  const output = transaction.outputs[assertion.outputIndex];
  const data = transaction.outputs_data[assertion.outputIndex];
  if (!output) {
    return {
      ok: false,
      outputIndex: assertion.outputIndex,
      checks: [
        {
          field: "outputIndex",
          expected: assertion.outputIndex,
          actual: null,
          ok: false,
        },
      ],
    };
  }

  const checks: AssertionCheck[] = [];
  if (assertion.capacity !== undefined) {
    checks.push({
      field: "capacity",
      expected: assertion.capacity,
      actual: output.capacity,
      ok: hexEq(assertion.capacity, output.capacity),
    });
  }
  if (assertion.lock) checks.push(...scriptChecks("lock", assertion.lock, output.lock));
  if (assertion.type === null) {
    checks.push({
      field: "type",
      expected: null,
      actual: output.type ?? null,
      ok: output.type == null,
    });
  } else if (assertion.type) {
    checks.push(...scriptChecks("type", assertion.type, output.type));
  }
  if (assertion.data !== undefined) {
    checks.push({
      field: "data",
      expected: assertion.data,
      actual: data ?? null,
      ok: hexEq(assertion.data, data),
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    outputIndex: assertion.outputIndex,
    checks,
  };
}

export function verifyExpectedCells(
  transaction: RpcTransactionLike,
  assertions: ExpectedCellAssertion[],
): AssertionResult[] {
  return assertions.map((assertion) => verifyExpectedCell(transaction, assertion));
}
