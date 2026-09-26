import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CellFlowError, type ChainObservation, type OutPointRef } from "@cellflow/core";

export interface RpcTransactionStatus {
  status: "pending" | "proposed" | "committed" | "unknown" | "rejected";
  block_hash?: string | null;
  reason?: string | null;
}

export interface RpcTransactionResult {
  transaction?: {
    outputs: Array<{
      capacity: string;
      lock: { code_hash: string; hash_type: string; args: string };
      type?: { code_hash: string; hash_type: string; args: string } | null;
    }>;
    outputs_data: string[];
    [key: string]: unknown;
  } | null;
  tx_status?: RpcTransactionStatus;
  [key: string]: unknown;
}

export interface RpcLiveCellResult {
  status: string;
  block_hash?: string | null;
  cell?: {
    output: {
      capacity: string;
      lock: { code_hash: string; hash_type: string; args: string };
      type?: { code_hash: string; hash_type: string; args: string } | null;
    };
    data?: { content?: string; hash?: string } | null;
  } | null;
}

interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcIdentityExpectation {
  chain?: string | null;
  genesisHash?: string | null;
}

export type CanonicalInputState = "LIVE" | "SPENT" | "UNKNOWN";
export type PoolInputState = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export type InputInspectionState =
  | "ALL_LIVE"
  | "MEMPOOL_CONTENDED"
  | "CANONICALLY_SPENT"
  | "UNKNOWN";

export interface InputObservation {
  outPoint: OutPointRef;
  canonical: CanonicalInputState;
  poolAware: PoolInputState;
  canonicalRpcStatus: string | null;
  poolRpcStatus: string | null;
  creatorTxStatus: string | null;
  creatorBlockHash: string | null;
  creatorBlockNumber: string | null;
  liveBlockHash: string | null;
}

export interface InputInspection {
  state: InputInspectionState;
  inputs: InputObservation[];
  endpoint: string;
  observedAt: string;
  tipBlockNumber: string | null;
}

export interface RpcObservationBundle {
  observation: ChainObservation;
  rpcResult: RpcTransactionResult | null;
  endpoint: string;
  inputInspection?: InputInspection;
}

function normalizeHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function parseRpcUrls(...sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const part of source.split(/[\s,]+/)) {
      const value = part.trim();
      if (!value || seen.has(value)) continue;
      let parsed: URL;
      try { parsed = new URL(value); } catch { continue; }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      if (parsed.username || parsed.password) continue;
      seen.add(parsed.toString());
      urls.push(parsed.toString());
    }
  }
  return urls;
}


function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function inV4Range(ip: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isBlockedRpcIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, prefix]) => inV4Range(ip, String(base), Number(prefix)));
  }
  if (family === 6) {
    const value = ip.toLowerCase();
    const mappedDotted = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedDotted && isIP(mappedDotted) === 4) return isBlockedRpcIp(mappedDotted);
    const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex?.[1] && mappedHex[2]) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isBlockedRpcIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return (
      value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8") ||
      value.startsWith("2002:") || value.startsWith("2001:0000:") || value.startsWith("64:ff9b::")
    );
  }
  return true;
}

interface ResolvedRpcDestination {
  url: URL;
  address: string;
  family: 4 | 6;
}

function allowLocalRpc(url: URL): boolean {
  const explicit = process.env.CKB_ALLOW_INSECURE_RPC === "true";
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  return localHost && (explicit || process.env.NODE_ENV !== "production");
}

export async function resolveRpcDestination(rawUrl: string): Promise<ResolvedRpcDestination> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CellFlowError("RPC_UNAVAILABLE", "CKB RPC URL is invalid", 503);
  }
  if (url.username || url.password) {
    throw new CellFlowError("RPC_UNAVAILABLE", "CKB RPC URL must not contain credentials", 503);
  }
  const localAllowed = allowLocalRpc(url);
  if (url.protocol !== "https:" && !(localAllowed && url.protocol === "http:")) {
    throw new CellFlowError("RPC_UNAVAILABLE", "CKB RPC must use HTTPS outside explicit local development", 503);
  }
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new CellFlowError("RPC_UNAVAILABLE", "CKB RPC hostname did not resolve", 503);
  }
  if (!localAllowed && records.some((record) => isBlockedRpcIp(record.address))) {
    throw new CellFlowError("RPC_UNAVAILABLE", "CKB RPC hostname resolves to a blocked address", 503);
  }
  const chosen = records.find((record) => record.family === 4 || record.family === 6);
  if (!chosen || (chosen.family !== 4 && chosen.family !== 6)) {
    throw new CellFlowError("RPC_UNAVAILABLE", "CKB RPC hostname resolved to an unsupported address", 503);
  }
  return { url, address: chosen.address, family: chosen.family };
}

function postPinnedRpc<T>(destination: ResolvedRpcDestination, body: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestOptions: https.RequestOptions = {
      protocol: destination.url.protocol,
      hostname: destination.address,
      family: destination.family,
      port: destination.url.port ? Number(destination.url.port) : destination.url.protocol === "https:" ? 443 : 80,
      method: "POST",
      path: `${destination.url.pathname}${destination.url.search}`,
      servername: destination.url.hostname,
      headers: {
        "content-type": "application/json",
        "user-agent": "CellFlow/0.3",
        host: destination.url.host,
        "content-length": Buffer.byteLength(body).toString(),
      },
      timeout: rpcTimeoutMs(),
    };
    const onResponse = (response: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) {
          response.destroy(new Error("RPC response exceeds 2 MB safety limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(new Error(`RPC HTTP ${response.statusCode ?? 0}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch {
          reject(new Error("RPC response was not valid JSON"));
        }
      });
    };
    const request = destination.url.protocol === "https:"
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse);
    request.on("timeout", () => request.destroy(new Error("RPC request timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

type EndpointFailureState = { failures: number; cooldownUntil: number };
const endpointFailures = new Map<string, EndpointFailureState>();

function rpcCircuitThreshold(): number {
  const configured = Number(process.env.CKB_RPC_CIRCUIT_FAILURES ?? "2");
  return Number.isFinite(configured) ? Math.min(Math.max(Math.floor(configured), 1), 10) : 2;
}

function rpcCircuitCooldownMs(): number {
  const configured = Number(process.env.CKB_RPC_CIRCUIT_COOLDOWN_MS ?? "30000");
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1000), 300000) : 30000;
}

function noteEndpointSuccess(url: string): void {
  endpointFailures.delete(url);
}

function noteEndpointFailure(url: string): void {
  const current = endpointFailures.get(url) ?? { failures: 0, cooldownUntil: 0 };
  const failures = current.failures + 1;
  endpointFailures.set(url, {
    failures,
    cooldownUntil: failures >= rpcCircuitThreshold() ? Date.now() + rpcCircuitCooldownMs() : 0,
  });
}

function healthyFirst(urls: string[]): string[] {
  const now = Date.now();
  const available = urls.filter((url) => (endpointFailures.get(url)?.cooldownUntil ?? 0) <= now);
  if (available.length > 0) return available;
  return [...urls].sort(
    (a, b) => (endpointFailures.get(a)?.cooldownUntil ?? 0) - (endpointFailures.get(b)?.cooldownUntil ?? 0),
  ).slice(0, 1);
}

function rpcTimeoutMs(): number {
  const configured = Number(process.env.CKB_RPC_TIMEOUT_MS ?? "10000");
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1000), 30000) : 10000;
}

class RpcEndpointSession {
  private requestId = 1;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    // Resolve and validate on every request, then pin the socket to the validated
    // address. This prevents a hostname that was safe during setup from being
    // DNS-rebound to loopback, RFC1918, link-local or metadata infrastructure.
    const destination = await resolveRpcDestination(this.url);
    const payload = await postPinnedRpc<JsonRpcEnvelope<T>>(
      destination,
      JSON.stringify({ jsonrpc: "2.0", id: this.requestId++, method, params }),
    );
    if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
    if (!("result" in payload)) throw new Error("RPC response did not include result");
    return payload.result as T;
  }

  async assertIdentity(expected: RpcIdentityExpectation): Promise<void> {
    if (!expected.chain && !expected.genesisHash) return;
    const [info, genesis] = await Promise.all([
      expected.chain ? this.call<Record<string, unknown>>("get_blockchain_info", []) : Promise.resolve(null),
      expected.genesisHash ? this.call<string | null>("get_block_hash", ["0x0"]) : Promise.resolve(null),
    ]);
    if (expected.chain) {
      const actualChain = info && typeof info.chain === "string" ? info.chain : null;
      if (actualChain !== expected.chain) {
        throw new CellFlowError(
          "RPC_RESPONSE_INVALID",
          `RPC endpoint network mismatch: expected ${expected.chain}, received ${actualChain ?? "unknown"}`,
          503,
        );
      }
    }
    if (expected.genesisHash) {
      const expectedGenesis = normalizeHash(expected.genesisHash);
      const actualGenesis = normalizeHash(genesis);
      if (!expectedGenesis || actualGenesis !== expectedGenesis) {
        throw new CellFlowError("RPC_RESPONSE_INVALID", "RPC endpoint genesis hash mismatch", 503);
      }
    }
  }
}

export class CkbRpcClient {
  private readonly urls: string[];

  constructor(urls: string[]) {
    this.urls = parseRpcUrls(...urls);
    if (this.urls.length === 0) throw new Error("At least one valid CKB RPC URL is required");
  }

  endpoints(): string[] {
    return [...this.urls];
  }

  private async withSession<T>(operation: (session: RpcEndpointSession) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (const url of healthyFirst(this.urls)) {
      const session = new RpcEndpointSession(url);
      try {
        const result = await operation(session);
        noteEndpointSuccess(url);
        return result;
      } catch (error) {
        noteEndpointFailure(url);
        lastError = error instanceof Error ? error : new Error("Unknown RPC failure");
      }
    }
    throw new CellFlowError(
      "RPC_UNAVAILABLE",
      lastError?.message ?? "All configured CKB RPC endpoints failed or are cooling down",
      503,
    );
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.withSession((session) => session.call<T>(method, params));
  }

  async getTransaction(txHash: string): Promise<RpcTransactionResult | null> {
    return this.call<RpcTransactionResult | null>("get_transaction", [txHash]);
  }

  async getHeader(blockHash: string): Promise<Record<string, unknown> | null> {
    return this.call<Record<string, unknown> | null>("get_header", [blockHash]);
  }

  async getTipHeader(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("get_tip_header", []);
  }

  async getGenesisHash(): Promise<string | null> {
    return this.call<string | null>("get_block_hash", ["0x0"]);
  }

  async getBlockchainInfo(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("get_blockchain_info", []);
  }

  async getLiveCell(txHash: string, outputIndex: number, endpoint?: string): Promise<RpcLiveCellResult | null> {
    const params = [{ tx_hash: txHash, index: `0x${outputIndex.toString(16)}` }, true];
    if (endpoint) return new RpcEndpointSession(endpoint).call<RpcLiveCellResult | null>("get_live_cell", params);
    return this.call<RpcLiveCellResult | null>("get_live_cell", params);
  }

  async inspectInputOutPoints(
    inputOutPoints: OutPointRef[],
    expectedIdentity: RpcIdentityExpectation = {},
  ): Promise<InputInspection> {
    return this.withSession(async (session) => {
      await session.assertIdentity(expectedIdentity);
      return inspectInputOutPointsOnSession(session, inputOutPoints);
    });
  }

  async inspectInputOutPointsAt(
    endpoint: string,
    inputOutPoints: OutPointRef[],
    expectedIdentity: RpcIdentityExpectation = {},
  ): Promise<InputInspection> {
    if (!this.urls.includes(endpoint)) {
      throw new CellFlowError("RPC_UNAVAILABLE", "Requested corroboration endpoint is not configured", 503);
    }
    const session = new RpcEndpointSession(endpoint);
    await session.assertIdentity(expectedIdentity);
    return inspectInputOutPointsOnSession(session, inputOutPoints);
  }

  async observe(
    txHash: string,
    prior?: { blockHash: string; blockNumber: string },
    expectedIdentity: RpcIdentityExpectation = {},
    inputOutPoints: OutPointRef[] = [],
  ): Promise<RpcObservationBundle> {
    return this.withSession(async (session) => {
      // Validate the exact endpoint selected by failover before trusting chain
      // observations from it. This prevents a misconfigured fallback from
      // silently reconciling a project against another CKB network.
      await session.assertIdentity(expectedIdentity);
      const observedAt = new Date().toISOString();
      const result = await session.call<RpcTransactionResult | null>("get_transaction", [txHash]);
      let priorCommitCanonical: boolean | undefined;
      if (prior) {
        const canonical = await session.call<string | null>("get_block_hash", [prior.blockNumber]);
        priorCommitCanonical = canonical?.toLowerCase() === prior.blockHash.toLowerCase();
      }

      if (!result || !result.tx_status) {
        const inputInspection = inputOutPoints.length > 0
          ? await inspectInputOutPointsOnSession(session, inputOutPoints)
          : undefined;
        return {
          observation: {
            status: "UNKNOWN", observedAt,
            raw: {
              txStatus: null,
              priorCommitCanonical,
              ...(inputInspection ? { inputInspection } : {}),
            },
            rpcEndpoint: session.url,
            ...(priorCommitCanonical === undefined ? {} : { priorCommitCanonical }),
          },
          rpcResult: result,
          endpoint: session.url,
          ...(inputInspection ? { inputInspection } : {}),
        };
      }

      const status = result.tx_status.status;
      if (status === "committed") {
        const blockHash = result.tx_status.block_hash ?? undefined;
        const [header, tip] = await Promise.all([
          blockHash ? session.call<Record<string, unknown> | null>("get_header", [blockHash]) : Promise.resolve(null),
          session.call<Record<string, unknown>>("get_tip_header", []),
        ]);
        const blockNumber = headerNumber(header);
        const tipBlockNumber = headerNumber(tip);
        const canonicalBlockHash = blockNumber
          ? await session.call<string | null>("get_block_hash", [blockNumber])
          : null;
        const currentCanonical = !blockHash || !canonicalBlockHash
          ? undefined
          : canonicalBlockHash.toLowerCase() === blockHash.toLowerCase();
        if (currentCanonical === false) {
          return {
            observation: {
              status: "UNKNOWN", observedAt, rpcEndpoint: session.url,
              raw: { txStatus: status, blockHash, blockNumber, canonicalBlockHash, priorCommitCanonical },
              ...(canonicalBlockHash ? { canonicalBlockHash } : {}),
              ...(priorCommitCanonical === undefined ? {} : { priorCommitCanonical }),
            },
            rpcResult: result,
            endpoint: session.url,
          };
        }
        return {
          observation: {
            status: "COMMITTED", observedAt, rpcEndpoint: session.url,
            raw: { txStatus: status, blockHash, blockNumber, tipBlockNumber, canonicalBlockHash, priorCommitCanonical },
            ...(blockHash ? { blockHash } : {}),
            ...(blockNumber ? { blockNumber } : {}),
            ...(tipBlockNumber ? { tipBlockNumber } : {}),
            ...(canonicalBlockHash ? { canonicalBlockHash } : {}),
            ...(priorCommitCanonical === undefined ? {} : { priorCommitCanonical }),
          },
          rpcResult: result,
          endpoint: session.url,
        };
      }

      const base = {
        observedAt,
        rpcEndpoint: session.url,
        raw: { txStatus: status, reason: result.tx_status.reason ?? null, priorCommitCanonical },
        ...(priorCommitCanonical === undefined ? {} : { priorCommitCanonical }),
      };
      if (status === "pending") return { observation: { ...base, status: "PENDING" as const }, rpcResult: result, endpoint: session.url };
      if (status === "proposed") return { observation: { ...base, status: "PROPOSED" as const }, rpcResult: result, endpoint: session.url };
      if (status === "rejected") {
        return {
          observation: {
            ...base,
            status: "REJECTED",
            ...(result.tx_status.reason ? { rejectionReason: result.tx_status.reason } : {}),
          },
          rpcResult: result,
          endpoint: session.url,
        };
      }
      const inputInspection = inputOutPoints.length > 0
        ? await inspectInputOutPointsOnSession(session, inputOutPoints)
        : undefined;
      return {
        observation: {
          ...base,
          status: "UNKNOWN" as const,
          raw: {
            txStatus: status,
            reason: result.tx_status.reason ?? null,
            priorCommitCanonical,
            ...(inputInspection ? { inputInspection } : {}),
          },
        },
        rpcResult: result,
        endpoint: session.url,
        ...(inputInspection ? { inputInspection } : {}),
      };
    });
  }
}

function headerNumber(header: Record<string, unknown> | null): string | undefined {
  if (!header) return undefined;
  if (typeof header.number === "string") return header.number;
  const inner = header.inner;
  if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).number === "string") {
    return String((inner as Record<string, unknown>).number);
  }
  return undefined;
}

function liveCellParams(outPoint: OutPointRef, includeTxPool: boolean): unknown[] {
  return [
    { tx_hash: outPoint.txHash, index: `0x${outPoint.index.toString(16)}` },
    false,
    includeTxPool,
  ];
}

async function creatorCanonicalEvidence(
  session: RpcEndpointSession,
  outPoint: OutPointRef,
): Promise<{
  canonical: boolean;
  txStatus: string | null;
  blockHash: string | null;
  blockNumber: string | null;
}> {
  const creator = await session.call<RpcTransactionResult | null>("get_transaction", [outPoint.txHash]);
  const txStatus = creator?.tx_status?.status ?? null;
  const blockHash = normalizeHash(creator?.tx_status?.block_hash);
  if (txStatus !== "committed" || !creator?.transaction || !blockHash) {
    return { canonical: false, txStatus, blockHash, blockNumber: null };
  }
  if (outPoint.index >= creator.transaction.outputs.length) {
    return { canonical: false, txStatus, blockHash, blockNumber: null };
  }
  const header = await session.call<Record<string, unknown> | null>("get_header", [blockHash]);
  const blockNumber = headerNumber(header) ?? null;
  if (!blockNumber) return { canonical: false, txStatus, blockHash, blockNumber: null };
  const canonicalHash = normalizeHash(await session.call<string | null>("get_block_hash", [blockNumber]));
  return {
    canonical: canonicalHash === blockHash,
    txStatus,
    blockHash,
    blockNumber,
  };
}

async function inspectInputOutPointsOnSession(
  session: RpcEndpointSession,
  inputOutPoints: OutPointRef[],
): Promise<InputInspection> {
  const observedAt = new Date().toISOString();
  const inputs: InputObservation[] = [];

  for (const outPoint of inputOutPoints) {
    const canonicalResult = await session.call<RpcLiveCellResult | null>(
      "get_live_cell",
      liveCellParams(outPoint, false),
    );
    const canonicalRpcStatus = canonicalResult?.status?.toLowerCase() ?? null;

    let canonical: CanonicalInputState = "UNKNOWN";
    let poolAware: PoolInputState = "UNKNOWN";
    let poolRpcStatus: string | null = null;
    let creatorTxStatus: string | null = null;
    let creatorBlockHash: string | null = null;
    let creatorBlockNumber: string | null = null;
    let liveBlockHash: string | null = normalizeHash(canonicalResult?.block_hash);

    if (canonicalRpcStatus === "live") {
      canonical = "LIVE";
      const poolResult = await session.call<RpcLiveCellResult | null>(
        "get_live_cell",
        liveCellParams(outPoint, true),
      );
      poolRpcStatus = poolResult?.status?.toLowerCase() ?? null;
      poolAware = poolRpcStatus === "live" ? "AVAILABLE" : "UNAVAILABLE";
    } else {
      // Modern CKB may report a spent Cell as `unknown`; `dead` is deprecated.
      // Prove spend conservatively: the creator transaction/output must still be
      // canonically committed, while the output itself is no longer live.
      const creator = await creatorCanonicalEvidence(session, outPoint);
      creatorTxStatus = creator.txStatus;
      creatorBlockHash = creator.blockHash;
      creatorBlockNumber = creator.blockNumber;
      canonical = creator.canonical ? "SPENT" : "UNKNOWN";
    }

    inputs.push({
      outPoint,
      canonical,
      poolAware,
      canonicalRpcStatus,
      poolRpcStatus,
      creatorTxStatus,
      creatorBlockHash,
      creatorBlockNumber,
      liveBlockHash,
    });
  }

  const tip = await session.call<Record<string, unknown>>("get_tip_header", []);
  const tipBlockNumber = headerNumber(tip) ?? null;
  const state: InputInspectionState = inputs.some((item) => item.canonical === "SPENT")
    ? "CANONICALLY_SPENT"
    : inputs.some((item) => item.canonical === "UNKNOWN")
      ? "UNKNOWN"
      : inputs.some((item) => item.poolAware === "UNAVAILABLE")
        ? "MEMPOOL_CONTENDED"
        : "ALL_LIVE";

  return { state, inputs, endpoint: session.url, observedAt, tipBlockNumber };
}

export async function observeTransaction(
  client: CkbRpcClient,
  txHash: string,
  prior?: { blockHash: string; blockNumber: string },
  expectedIdentity: RpcIdentityExpectation = {},
  inputOutPoints: OutPointRef[] = [],
): Promise<RpcObservationBundle> {
  return client.observe(txHash, prior, expectedIdentity, inputOutPoints);
}
