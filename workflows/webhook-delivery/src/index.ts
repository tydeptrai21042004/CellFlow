import { randomUUID } from "node:crypto";
import { CellFlowRepository } from "@cellflow/db";
import { deliverWebhook } from "@cellflow/webhooks";

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function deliverDueWebhooks(
  limit = 25,
  projectId?: string,
): Promise<{ attempted: number; delivered: number; leaseLost: number }> {
  const repository = new CellFlowRepository();
  const leaseOwner = randomUUID();
  const concurrency = boundedInteger(process.env.CELLFLOW_WEBHOOK_CONCURRENCY, 6, 1, 12);
  const itemLeaseSeconds = boundedInteger(process.env.CELLFLOW_WEBHOOK_LEASE_SECONDS, 45, 20, 300);
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const initialLeaseSeconds = Math.min(
    900,
    itemLeaseSeconds * Math.max(1, Math.ceil(boundedLimit / concurrency)),
  );
  const due = await repository.claimDueWebhookDeliveries(boundedLimit, leaseOwner, initialLeaseSeconds, projectId);
  let delivered = 0;
  let leaseLost = 0;

  await runWithConcurrency(due, concurrency, async (item) => {
    const renewed = await repository.renewWebhookDeliveryLease(item.id, leaseOwner, itemLeaseSeconds);
    if (!renewed) {
      leaseLost += 1;
      return;
    }
    try {
      const result = await deliverWebhook({ ...item, leaseOwner }, repository);
      if (result.delivered) delivered += 1;
    } catch {
      // deliverWebhook normally records retry state itself. This fallback prevents
      // a claimed row from remaining stuck if an unexpected exception escapes.
      await repository.releaseWebhookDeliveryLease(item.id, leaseOwner).catch(() => undefined);
    }
  });

  return { attempted: due.length, delivered, leaseLost };
}

export async function deliverWebhookEvent(
  projectId: string,
  eventId: string,
): Promise<{ attempted: number; delivered: number; leaseLost: number }> {
  const repository = new CellFlowRepository();
  const leaseOwner = randomUUID();
  const itemLeaseSeconds = boundedInteger(process.env.CELLFLOW_WEBHOOK_LEASE_SECONDS, 45, 20, 300);
  const due = await repository.claimWebhookDeliveriesForEvent(projectId, eventId, leaseOwner, itemLeaseSeconds);
  let delivered = 0;
  let leaseLost = 0;
  await runWithConcurrency(due, Math.min(6, Math.max(1, due.length)), async (item) => {
    const renewed = await repository.renewWebhookDeliveryLease(item.id, leaseOwner, itemLeaseSeconds);
    if (!renewed) {
      leaseLost += 1;
      return;
    }
    const result = await deliverWebhook({ ...item, leaseOwner }, repository);
    if (result.delivered) delivered += 1;
  });
  return { attempted: due.length, delivered, leaseLost };
}
