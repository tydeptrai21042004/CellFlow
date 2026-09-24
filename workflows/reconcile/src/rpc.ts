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

interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export class CkbRpcClient {
  private requestId = 1;

  constructor(private readonly urls: string[]) {
    if (urls.length === 0) throw new Error("At least one CKB RPC URL is required");
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: Error | undefined;
    for (const url of this.urls) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "CellFlow/0.1" },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.requestId++, method, params }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error("RPC response exceeds 2 MB safety limit");
        const payload = JSON.parse(text) as JsonRpcEnvelope<T>;
        if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
        if (!("result" in payload)) throw new Error("RPC response did not include result");
        return payload.result as T;
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

  async getTransaction(txHash: string): Promise<RpcTransactionResult | null> {
    return this.call<RpcTransactionResult | null>("get_transaction", [txHash]);
  }

  async getHeader(blockHash: string): Promise<Record<string, unknown> | null> {
    return this.call<Record<string, unknown> | null>("get_header", [blockHash]);
  }

  async getTipHeader(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("get_tip_header", []);
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
): Promise<{ observation: ChainObservation; rpcResult: RpcTransactionResult | null }> {
  const observedAt = new Date().toISOString();
  const result = await client.getTransaction(txHash);
  if (!result || !result.tx_status) {
    return {
      observation: { status: "UNKNOWN", observedAt, raw: result },
      rpcResult: result,
    };
  }

  const status = result.tx_status.status;
  if (status === "committed") {
    const blockHash = result.tx_status.block_hash ?? undefined;
    const [header, tip] = await Promise.all([
      blockHash ? client.getHeader(blockHash) : Promise.resolve(null),
      client.getTipHeader(),
    ]);
    return {
      observation: {
        status: "COMMITTED",
        observedAt,
        raw: result,
        ...(blockHash ? { blockHash } : {}),
        ...(headerNumber(header) ? { blockNumber: headerNumber(header) } : {}),
        ...(headerNumber(tip) ? { tipBlockNumber: headerNumber(tip) } : {}),
      },
      rpcResult: result,
    };
  }

  if (status === "pending") {
    return { observation: { status: "PENDING", observedAt, raw: result }, rpcResult: result };
  }
  if (status === "proposed") {
    return { observation: { status: "PROPOSED", observedAt, raw: result }, rpcResult: result };
  }
  if (status === "rejected") {
    return {
      observation: {
        status: "REJECTED",
        observedAt,
        raw: result,
        ...(result.tx_status.reason ? { rejectionReason: result.tx_status.reason } : {}),
      },
      rpcResult: result,
    };
  }
  return { observation: { status: "UNKNOWN", observedAt, raw: result }, rpcResult: result };
}
