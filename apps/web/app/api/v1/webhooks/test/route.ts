import { randomUUID } from "node:crypto";
import { errorResponse } from "@cellflow/api";
import { deliverWebhookEvent } from "@cellflow/webhook-delivery";
import { projectFromRequest, repository } from "../../../../../lib/server.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request, "admin");
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
    const delivery = await deliverWebhookEvent(project.id, eventId);
    return Response.json({ queued, delivery }, { status: 202 });
  } catch (error) {
    return errorResponse(error, request);
  }
}
