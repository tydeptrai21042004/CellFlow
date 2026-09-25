import { randomUUID } from "node:crypto";
import { CellFlowRepository } from "@cellflow/db";
import { deliverWebhook } from "@cellflow/webhooks";

export async function deliverDueWebhooks(
  limit = 25,
  projectId?: string,
): Promise<{ attempted: number; delivered: number }> {
  const repository = new CellFlowRepository();
  const leaseOwner = randomUUID();
  const due = await repository.claimDueWebhookDeliveries(limit, leaseOwner, 75, projectId);
  let delivered = 0;
  for (const item of due) {
    const result = await deliverWebhook(item, repository);
    if (result.delivered) delivered += 1;
  }
  return { attempted: due.length, delivered };
}
