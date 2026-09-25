import { repository } from "../../../lib/server.ts";
import { CkbRpcClient, parseRpcUrls } from "@cellflow/reconcile";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  const urls = parseRpcUrls(process.env.CKB_RPC_URL, process.env.CKB_RPC_FALLBACK_URL, process.env.CKB_RPC_FALLBACK_URLS);
  const checks = {
    database: false,
    rpc: false,
    encryptionKey: Boolean(process.env.CELLFLOW_ENCRYPTION_KEY && process.env.CELLFLOW_ENCRYPTION_KEY.length >= 32),
    cronSecret: Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16),
  };
  const errors: string[] = [];

  try { checks.database = await repository.ping(); } catch { errors.push("database unavailable"); }
  if (urls.length === 0) {
    errors.push("CKB RPC not configured");
  } else {
    try { await new CkbRpcClient(urls).getTipHeader(); checks.rpc = true; } catch { errors.push("CKB RPC unavailable"); }
  }
  if (!checks.encryptionKey) errors.push("encryption key missing or too short");
  if (!checks.cronSecret) errors.push("cron secret missing or too short");

  const ok = Object.values(checks).every(Boolean);
  return Response.json({ ok, service: "cellflow", version: "0.2.0", checks, errors }, { status: ok ? 200 : 503 });
}
