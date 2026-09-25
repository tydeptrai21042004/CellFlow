import http from "node:http";
import https from "node:https";
import { CellFlowRepository, type WebhookDeliveryRecord } from "@cellflow/db";
import { decryptSecret, signWebhook } from "./crypto.ts";
import { validateWebhookDestination } from "./ssrf.ts";

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

export function webhookBackoffMs(attempt: number): number {
  const base = Math.min(60 * 60 * 1000, 5_000 * 2 ** Math.min(Math.max(attempt, 0), 8));
  return base + Math.floor(Math.random() * 1_000);
}

export function retryAfterMs(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60 * 60 * 1000, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(60 * 60 * 1000, Math.max(0, date - now));
}

type PinnedResponse = { status: number; retryAfter?: string };

function postPinned(input: {
  url: URL; address: string; family: 4 | 6; headers: Record<string, string>; body: string;
}): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const requestOptions: https.RequestOptions = {
      protocol: input.url.protocol,
      hostname: input.address,
      family: input.family,
      port: input.url.port ? Number(input.url.port) : input.url.protocol === "https:" ? 443 : 80,
      method: "POST",
      path: `${input.url.pathname}${input.url.search}`,
      servername: input.url.hostname,
      headers: { ...input.headers, host: input.url.host, "content-length": Buffer.byteLength(input.body).toString() },
      timeout: boundedInteger(process.env.CELLFLOW_WEBHOOK_TIMEOUT_MS, 10_000, 1_000, 30_000),
    };
    const onResponse = (response: http.IncomingMessage) => {
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) response.destroy(new Error("Webhook response body exceeds 64 KB"));
      });
      response.on("error", reject);
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        ...(typeof response.headers["retry-after"] === "string" ? { retryAfter: response.headers["retry-after"] } : {}),
      }));
    };
    const request = input.url.protocol === "https:"
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse);
    request.on("timeout", () => request.destroy(new Error("Webhook request timed out")));
    request.on("error", reject);
    request.end(input.body);
  });
}

function nextWebhookAttempt(attemptCount: number, retryAfter?: string): Date | undefined {
  const maxAttempts = boundedInteger(process.env.CELLFLOW_WEBHOOK_MAX_ATTEMPTS, 8, 1, 20);
  const currentAttempt = attemptCount + 1;
  if (currentAttempt >= maxAttempts) return undefined;
  const serverDelay = retryAfterMs(retryAfter);
  const delay = serverDelay ?? webhookBackoffMs(currentAttempt);
  return new Date(Date.now() + delay);
}

export async function deliverWebhook(
  delivery: WebhookDeliveryRecord,
  repository = new CellFlowRepository(),
): Promise<{ delivered: boolean; status?: number }> {
  const completionIdentity = delivery.leaseOwner ? { leaseOwner: delivery.leaseOwner } : {};
  const endpoint = await repository.getWebhookEndpoint(delivery.projectId, delivery.endpointId);
  if (!endpoint || !endpoint.enabled) {
    await repository.completeWebhookDelivery({ id: delivery.id, ...completionIdentity, success: false, error: "Endpoint disabled or missing" });
    return { delivered: false };
  }

  try {
    const destination = await validateWebhookDestination(endpoint.url, {
      allowHttpLocalhost: process.env.NODE_ENV !== "production",
    });
    const masterSecret = process.env.CELLFLOW_ENCRYPTION_KEY;
    if (!masterSecret) throw new Error("CELLFLOW_ENCRYPTION_KEY is required");
    const secret = decryptSecret(endpoint.signingSecretEncrypted, masterSecret);
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify(delivery.payload);
    const signature = signWebhook(rawBody, timestamp, secret);

    // DNS is resolved and policy-checked immediately before delivery. The socket is
    // pinned to that validated IP while TLS SNI/Host remain the original host.
    const response = await postPinned({
      ...destination,
      headers: {
        "content-type": "application/json",
        "user-agent": "CellFlow/0.3",
        "x-cellflow-signature": `v1=${signature}`,
        "x-cellflow-timestamp": String(timestamp),
        "x-cellflow-event-id": delivery.eventId,
        "x-cellflow-delivery-id": delivery.id,
        "x-cellflow-attempt": String(delivery.attemptCount + 1),
      },
      body: rawBody,
    });

    if (response.status >= 200 && response.status < 300) {
      await repository.completeWebhookDelivery({ id: delivery.id, ...completionIdentity, success: true, responseStatus: response.status });
      return { delivered: true, status: response.status };
    }

    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    const nextAttempt = retryable ? nextWebhookAttempt(delivery.attemptCount, response.retryAfter) : undefined;
    await repository.completeWebhookDelivery({
      id: delivery.id,
      ...completionIdentity,
      success: false,
      responseStatus: response.status,
      error: `HTTP ${response.status}`,
      ...(nextAttempt ? { retryAt: nextAttempt } : {}),
    });
    return { delivered: false, status: response.status };
  } catch (error) {
    const nextAttempt = nextWebhookAttempt(delivery.attemptCount);
    await repository.completeWebhookDelivery({
      id: delivery.id,
      ...completionIdentity,
      success: false,
      error: error instanceof Error ? error.message : "Webhook delivery failed",
      ...(nextAttempt ? { retryAt: nextAttempt } : {}),
    });
    return { delivered: false };
  }
}
