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

export async function GET(request: Request) {
  try {
    if (!authorize(request)) {
      return Response.json({ error: { code: "AUTH_INVALID", message: "Invalid cron authorization" } }, { status: 401 });
    }
    const repository = new CellFlowRepository();
    const [reconciled, webhooks, prunedRateLimits] = await Promise.all([
      reconcileDue(25),
      deliverDueWebhooks(25),
      repository.pruneRateLimits(24),
    ]);
    return Response.json({ ok: true, reconciled, webhooks, prunedRateLimits });
  } catch (error) {
    return errorResponse(error);
  }
}
