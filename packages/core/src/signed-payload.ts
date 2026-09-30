function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pick(record: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function normalizeHex(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return /^0x[0-9a-f]*$/.test(text) ? text : null;
}

function normalizeInteger(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? BigInt(value)
        : BigInt(String(value));
    if (parsed < 0n) return null;
    return `0x${parsed.toString(16)}`;
  } catch {
    return null;
  }
}

function normalizeOutPoint(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const txHash = normalizeHex(pick(record, "txHash", "tx_hash"));
  const index = normalizeInteger(pick(record, "index"));
  if (!txHash || index === null) return null;
  return { txHash, index };
}

function normalizeScript(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  const record = asRecord(value);
  if (!record) return null;
  const codeHash = normalizeHex(pick(record, "codeHash", "code_hash"));
  const hashType = pick(record, "hashType", "hash_type");
  const args = normalizeHex(pick(record, "args"));
  if (!codeHash || typeof hashType !== "string" || args === null) return null;
  return { codeHash, hashType, args };
}

function normalizeCellDep(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const outPoint = normalizeOutPoint(pick(record, "outPoint", "out_point"));
  const depTypeValue = pick(record, "depType", "dep_type");
  if (!outPoint || typeof depTypeValue !== "string") return null;
  const depType = depTypeValue === "depGroup" ? "dep_group" : depTypeValue;
  return { outPoint, depType };
}

function normalizeInput(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const previousOutput = normalizeOutPoint(pick(record, "previousOutput", "previous_output"));
  const since = normalizeInteger(pick(record, "since"));
  if (!previousOutput || since === null) return null;
  return { since, previousOutput };
}

function normalizeOutput(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const capacity = normalizeInteger(pick(record, "capacity"));
  const lock = normalizeScript(pick(record, "lock"));
  const typeValue = pick(record, "type");
  const type = typeValue === null || typeValue === undefined ? null : normalizeScript(typeValue);
  if (capacity === null || !lock || (typeValue !== null && typeValue !== undefined && !type)) return null;
  return { capacity, lock, type };
}

function normalizeArray<T>(
  value: unknown,
  item: (entry: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const entry of value) {
    const normalized = item(entry);
    if (normalized === null) return null;
    result.push(normalized);
  }
  return result;
}

function normalizeHexArray(value: unknown): string[] | null {
  return normalizeArray(value, (entry) => normalizeHex(entry));
}

/**
 * Produce a deterministic application-level fingerprint of the complete signed
 * CKB transaction payload. Unlike the normal CKB raw transaction hash, this
 * includes witnesses. It is intentionally named a SHA-256 fingerprint rather
 * than a protocol witness hash so it cannot be confused with CKB consensus
 * hashing/Molecule serialization.
 */
export async function signedPayloadFingerprintSha256(value: unknown): Promise<string | null> {
  const record = asRecord(value);
  if (!record) return null;

  const version = normalizeInteger(pick(record, "version"));
  const cellDeps = normalizeArray(pick(record, "cellDeps", "cell_deps"), normalizeCellDep);
  const headerDeps = normalizeHexArray(pick(record, "headerDeps", "header_deps"));
  const inputs = normalizeArray(pick(record, "inputs"), normalizeInput);
  const outputs = normalizeArray(pick(record, "outputs"), normalizeOutput);
  const outputsData = normalizeHexArray(pick(record, "outputsData", "outputs_data"));
  const witnesses = normalizeHexArray(pick(record, "witnesses"));

  if (
    version === null || cellDeps === null || headerDeps === null || inputs === null ||
    outputs === null || outputsData === null || witnesses === null ||
    outputs.length !== outputsData.length
  ) {
    return null;
  }

  const canonical = JSON.stringify({
    version,
    cellDeps,
    headerDeps,
    inputs,
    outputs,
    outputsData,
    witnesses,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
