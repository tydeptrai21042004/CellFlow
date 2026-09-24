import { errorResponse } from "@cellflow/api";
import { reconcileDue } from "@cellflow/reconcile";
import { deliverDueWebhooks } from "@cellflow/webhook-delivery";

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
    const [reconciled, webhooks] = await Promise.all([
      reconcileDue(25),
      deliverDueWebhooks(25),
    ]);
    return Response.json({ ok: true, reconciled, webhooks });
  } catch (error) {
    return errorResponse(error);
  }
}
