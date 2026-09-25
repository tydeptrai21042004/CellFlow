import { errorResponse } from "@cellflow/api";
import { reconcileDue } from "@cellflow/reconcile";
import { deliverDueWebhooks } from "@cellflow/webhook-delivery";
import { CellFlowRepository } from "@cellflow/db";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function settled<T>(result: PromiseSettledResult<T>): { ok: true; value: T } | { ok: false; error: string } {
  if (result.status === "fulfilled") return { ok: true, value: result.value };
  return { ok: false, error: result.reason instanceof Error ? result.reason.message : "Task failed" };
}

export async function GET(request: Request) {
  try {
    if (!authorize(request)) {
      return Response.json({ error: { code: "AUTH_INVALID", message: "Invalid cron authorization" } }, { status: 401 });
    }
    const repository = new CellFlowRepository();
    const [reconcileResult, webhookResult, pruneResult] = await Promise.allSettled([
      reconcileDue(25),
      deliverDueWebhooks(25),
      repository.pruneRateLimits(24),
    ]);
    const tasks = {
      reconcile: settled(reconcileResult),
      webhooks: settled(webhookResult),
      rateLimitCleanup: settled(pruneResult),
    };
    const ok = Object.values(tasks).every((task) => task.ok);
    return Response.json({ ok, tasks, ranAt: new Date().toISOString() }, { status: ok ? 200 : 207 });
  } catch (error) {
    return errorResponse(error);
  }
}
