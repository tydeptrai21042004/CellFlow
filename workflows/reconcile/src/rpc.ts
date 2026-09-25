import { CellFlowError, type ChainObservation } from "@cellflow/core";

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
      seen.add(parsed.toString());
      urls.push(parsed.toString());
    }
  }
  return urls;
}

function rpcTimeoutMs(): number {
  const configured = Number(process.env.CKB_RPC_TIMEOUT_MS ?? "10000");
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1000), 30000) : 10000;
}

class RpcEndpointSession {
  private requestId = 1;
  constructor(readonly url: string) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "CellFlow/0.2" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.requestId++, method, params }),
      signal: AbortSignal.timeout(rpcTimeoutMs()),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("RPC response exceeds 2 MB safety limit");
    const payload = JSON.parse(text) as JsonRpcEnvelope<T>;
    if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
    if (!("result" in payload)) throw new Error("RPC response did not include result");
    return payload.result as T;
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
    for (const url of this.urls) {
      const session = new RpcEndpointSession(url);
      try {
        return await operation(session);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown RPC failure");
      }
    }
    throw new CellFlowError(
      "RPC_UNAVAILABLE",
      lastError?.message ?? "All configured CKB RPC endpoints failed",
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

  async getLiveCell(txHash: string, outputIndex: number, endpoint?: string): Promise<RpcLiveCellResult | null> {
    const params = [{ tx_hash: txHash, index: `0x${outputIndex.toString(16)}` }, true];
    if (endpoint) return new RpcEndpointSession(endpoint).call<RpcLiveCellResult | null>("get_live_cell", params);
    return this.call<RpcLiveCellResult | null>("get_live_cell", params);
  }

  async observe(txHash: string, prior?: { blockHash: string; blockNumber: string }): Promise<{
    observation: ChainObservation;
    rpcResult: RpcTransactionResult | null;
    endpoint: string;
  }> {
    return this.withSession(async (session) => {
      const observedAt = new Date().toISOString();
      const result = await session.call<RpcTransactionResult | null>("get_transaction", [txHash]);
      let priorCommitCanonical: boolean | undefined;
      if (prior) {
        const canonical = await session.call<string | null>("get_block_hash", [prior.blockNumber]);
        priorCommitCanonical = canonical?.toLowerCase() === prior.blockHash.toLowerCase();
      }

      if (!result || !result.tx_status) {
        return {
          observation: {
            status: "UNKNOWN", observedAt,
            raw: { txStatus: null, priorCommitCanonical },
            rpcEndpoint: session.url,
            ...(priorCommitCanonical === undefined ? {} : { priorCommitCanonical }),
          },
          rpcResult: result,
          endpoint: session.url,
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
      return { observation: { ...base, status: "UNKNOWN" as const }, rpcResult: result, endpoint: session.url };
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

export async function observeTransaction(
  client: CkbRpcClient,
  txHash: string,
  prior?: { blockHash: string; blockNumber: string },
): Promise<{ observation: ChainObservation; rpcResult: RpcTransactionResult | null; endpoint: string }> {
  return client.observe(txHash, prior);
}
