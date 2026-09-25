import { errorResponse } from "@cellflow/api";
import { CkbRpcClient, parseRpcUrls } from "@cellflow/reconcile";

export const runtime = "nodejs";

export async function GET() {
  try {
    const urls = parseRpcUrls(
      process.env.CKB_RPC_URL,
      process.env.CKB_RPC_FALLBACK_URL,
      process.env.CKB_RPC_FALLBACK_URLS,
    );
    if (urls.length === 0) return Response.json({ ok: false, error: "No CKB RPC endpoint is configured" }, { status: 503 });
    const client = new CkbRpcClient(urls);
    const startedAt = Date.now();
    const tip = await client.getTipHeader();
    return Response.json({
      ok: true,
      latencyMs: Date.now() - startedAt,
      configuredEndpoints: urls.length,
      tip: { number: tip.number ?? null, hash: tip.hash ?? null },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
