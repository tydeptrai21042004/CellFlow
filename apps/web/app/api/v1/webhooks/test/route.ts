import { randomUUID } from "node:crypto";
import { errorResponse } from "@cellflow/api";
import { deliverDueWebhooks } from "@cellflow/webhook-delivery";
import { projectFromRequest, repository } from "../../../../../lib/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request);
    const eventId = randomUUID();
    const queued = await repository.enqueueWebhookDeliveries({
      projectId: project.id,
      eventId,
      eventType: "webhook.test",
      payload: {
        id: eventId,
        type: "webhook.test",
        occurredAt: new Date().toISOString(),
        data: { projectId: project.id },
      },
    });
    const delivery = await deliverDueWebhooks(25);
    return Response.json({ queued, delivery });
  } catch (error) {
    return errorResponse(error);
  }
}
