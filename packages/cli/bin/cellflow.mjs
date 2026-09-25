#!/usr/bin/env node
import { randomUUID } from "node:crypto";

const endpoint = (process.env.CELLFLOW_ENDPOINT ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const apiKey = process.env.CELLFLOW_API_KEY ?? "";

async function request(path, init = {}, authenticated = true) {
  const requestId = randomUUID();
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      ...(authenticated && apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const remoteId = body?.error?.requestId ?? response.headers.get("x-request-id") ?? requestId;
    throw new Error(`${body?.error?.message ?? `HTTP ${response.status}`} [request ${remoteId}]`);
  }
  return body;
}

function requireKey() {
  if (!apiKey) throw new Error("CELLFLOW_API_KEY is required for this command");
}

function usage() {
  console.log(`CellFlow CLI 0.3\n\nCommands:\n  doctor\n  ready\n  operations\n  intents [limit]\n  intent <intentId>\n  reconcile <intentId>\n  evidence <intentId>\n  project-evidence\n  webhooks\n  keys\n  key-create <label>\n  key-revoke <keyId>\n\nEnvironment:\n  CELLFLOW_ENDPOINT   deployed base URL (default http://localhost:3000)\n  CELLFLOW_API_KEY    project API key`);
}

function settled(result) {
  return result.status === "fulfilled"
    ? { ok: true, value: result.value }
    : { ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

const [command, arg] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "--help") {
    usage();
  } else if (command === "doctor") {
    const publicChecks = await Promise.allSettled([
      request("/api/health", {}, false),
      request("/api/health/rpc", {}, false),
      request("/api/ready", {}, false),
    ]);
    let authenticated = { ok: false, skipped: true };
    if (apiKey) {
      const privateChecks = await Promise.allSettled([
        request("/api/v1/operations"),
        request("/api/v1/intents?limit=1"),
      ]);
      authenticated = { ok: privateChecks.every((item) => item.status === "fulfilled"), skipped: false, checks: privateChecks.map(settled) };
    }
    const report = {
      endpoint,
      public: {
        health: settled(publicChecks[0]),
        rpc: settled(publicChecks[1]),
        readiness: settled(publicChecks[2]),
      },
      authenticated,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!publicChecks.every((item) => item.status === "fulfilled") || (!authenticated.skipped && !authenticated.ok)) process.exitCode = 2;
  } else if (command === "ready") {
    console.log(JSON.stringify(await request("/api/ready", {}, !apiKey ? false : true), null, 2));
  } else if (command === "operations") {
    requireKey();
    console.log(JSON.stringify(await request("/api/v1/operations"), null, 2));
  } else if (command === "intents") {
    requireKey();
    const limit = Number(arg ?? "100");
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 100;
    console.log(JSON.stringify(await request(`/api/v1/intents?limit=${safeLimit}`), null, 2));
  } else if (command === "intent") {
    requireKey();
    if (!arg) throw new Error("intentId is required");
    console.log(JSON.stringify(await request(`/api/v1/intents/${encodeURIComponent(arg)}`), null, 2));
  } else if (command === "reconcile") {
    requireKey();
    if (!arg) throw new Error("intentId is required");
    console.log(JSON.stringify(await request(`/api/v1/intents/${encodeURIComponent(arg)}/reconcile`, { method: "POST", body: "{}" }), null, 2));
  } else if (command === "evidence") {
    requireKey();
    if (!arg) throw new Error("intentId is required");
    const result = await request(`/api/v1/intents/${encodeURIComponent(arg)}/evidence`);
    console.log(JSON.stringify(result.evidence ?? result, null, 2));
  } else if (command === "project-evidence") {
    requireKey();
    const result = await request("/api/v1/project-evidence");
    console.log(JSON.stringify(result.evidence ?? result, null, 2));
  } else if (command === "webhooks") {
    requireKey();
    console.log(JSON.stringify(await request("/api/v1/webhooks"), null, 2));
  } else if (command === "keys") {
    requireKey();
    console.log(JSON.stringify(await request("/api/v1/api-keys"), null, 2));
  } else if (command === "key-create") {
    requireKey();
    const result = await request("/api/v1/api-keys", { method: "POST", body: JSON.stringify({ label: arg ?? "rotated" }) });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "key-revoke") {
    requireKey();
    if (!arg) throw new Error("keyId is required");
    await request(`/api/v1/api-keys/${encodeURIComponent(arg)}`, { method: "DELETE" });
    console.log(JSON.stringify({ revoked: arg }));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`cellflow: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
