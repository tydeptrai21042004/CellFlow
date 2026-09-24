import { CellFlowRepository } from "@cellflow/db";
import { deliverWebhook } from "@cellflow/webhooks";

export async function deliverDueWebhooks(limit = 25): Promise<{ attempted: number; delivered: number }> {
  const repository = new CellFlowRepository();
  const due = await repository.listDueWebhookDeliveries(limit);
  let delivered = 0;
  for (const item of due) {
    const result = await deliverWebhook(item, repository);
    if (result.delivered) delivered += 1;
  }
  return { attempted: due.length, delivered };
}
