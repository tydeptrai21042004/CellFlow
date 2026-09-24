import { errorResponse } from "@cellflow/api";
import { CkbRpcClient } from "@cellflow/reconcile";

export const runtime = "nodejs";

export async function GET() {
  try {
    const urls = [process.env.CKB_RPC_URL, process.env.CKB_RPC_FALLBACK_URL].filter((v): v is string => Boolean(v));
    if (urls.length === 0) return Response.json({ ok: false, error: "CKB_RPC_URL is not configured" }, { status: 503 });
    const client = new CkbRpcClient(urls);
    const tip = await client.getTipHeader();
    return Response.json({ ok: true, tip: { number: tip.number ?? null, hash: tip.hash ?? null } });
  } catch (error) {
    return errorResponse(error);
  }
}
