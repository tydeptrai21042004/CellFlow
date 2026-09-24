import http from "node:http";
import https from "node:https";
import { CellFlowRepository, type WebhookDeliveryRecord } from "@cellflow/db";
import { decryptSecret, signWebhook } from "./crypto.js";
import { validateWebhookDestination } from "./ssrf.js";

export function webhookBackoffMs(attempt: number): number {
  const base = Math.min(60 * 60 * 1000, 5_000 * 2 ** Math.min(attempt, 8));
  return base + Math.floor(Math.random() * 1_000);
}

function postPinned(input: {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  body: string;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const requestOptions: https.RequestOptions = {
      protocol: input.url.protocol,
      hostname: input.address,
      family: input.family,
      port: input.url.port ? Number(input.url.port) : input.url.protocol === "https:" ? 443 : 80,
      method: "POST",
      path: `${input.url.pathname}${input.url.search}`,
      servername: input.url.hostname,
      headers: {
        ...input.headers,
        host: input.url.host,
        "content-length": Buffer.byteLength(input.body).toString(),
      },
      timeout: 10_000,
    };
    const onResponse = (response: http.IncomingMessage) => {
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) response.destroy(new Error("Webhook response body exceeds 64 KB"));
        });
      response.on("end", () => resolve(response.statusCode ?? 0));
    };
    const request = input.url.protocol === "https:"
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse);
    request.on("timeout", () => request.destroy(new Error("Webhook request timed out")));
    request.on("error", reject);
    request.end(input.body);
  });
}

export async function deliverWebhook(
  delivery: WebhookDeliveryRecord,
  repository = new CellFlowRepository(),
): Promise<{ delivered: boolean; status?: number }> {
  const endpoint = await repository.getWebhookEndpoint(delivery.projectId, delivery.endpointId);
  if (!endpoint || !endpoint.enabled) {
    await repository.completeWebhookDelivery({ id: delivery.id, success: false, error: "Endpoint disabled or missing" });
    return { delivered: false };
  }

  const destination = await validateWebhookDestination(endpoint.url, {
    allowHttpLocalhost: process.env.NODE_ENV !== "production",
  });
  const masterSecret = process.env.CELLFLOW_MASTER_SECRET;
  if (!masterSecret) throw new Error("CELLFLOW_MASTER_SECRET is required");
  const secret = decryptSecret(endpoint.signingSecretEncrypted, masterSecret);
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(delivery.payload);
  const signature = signWebhook(rawBody, timestamp, secret);

  try {
    // DNS is resolved and policy-checked immediately before delivery. The socket is
    // then pinned to that validated IP while TLS SNI/Host remain the original host,
    // preventing a second DNS lookup from turning a public hostname into an internal target.
    const status = await postPinned({
      ...destination,
      headers: {
        "content-type": "application/json",
        "user-agent": "CellFlow/0.1",
        "x-cellflow-signature": `v1=${signature}`,
        "x-cellflow-timestamp": String(timestamp),
        "x-cellflow-event-id": delivery.eventId,
        "x-cellflow-delivery-id": delivery.id,
      },
      body: rawBody,
    });

    if (status >= 200 && status < 300) {
      await repository.completeWebhookDelivery({ id: delivery.id, success: true, responseStatus: status });
      return { delivered: true, status };
    }

    const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
    const nextAttempt = delivery.attemptCount >= 8 || !retryable
      ? undefined
      : new Date(Date.now() + webhookBackoffMs(delivery.attemptCount));
    await repository.completeWebhookDelivery({
      id: delivery.id,
      success: false,
      responseStatus: status,
      error: `HTTP ${status}`,
      ...(nextAttempt ? { retryAt: nextAttempt } : {}),
    });
    return { delivered: false, status };
  } catch (error) {
    const nextAttempt = delivery.attemptCount >= 8
      ? undefined
      : new Date(Date.now() + webhookBackoffMs(delivery.attemptCount));
    await repository.completeWebhookDelivery({
      id: delivery.id,
      success: false,
      error: error instanceof Error ? error.message : "Webhook delivery failed",
      ...(nextAttempt ? { retryAt: nextAttempt } : {}),
    });
    return { delivered: false };
  }
}
