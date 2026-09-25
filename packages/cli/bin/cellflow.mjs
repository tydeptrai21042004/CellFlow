#!/usr/bin/env node
const endpoint = (process.env.CELLFLOW_ENDPOINT ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const apiKey = process.env.CELLFLOW_API_KEY ?? "";

async function request(path, init = {}, authenticated = true) {
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(authenticated && apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}

function requireKey() {
  if (!apiKey) throw new Error("CELLFLOW_API_KEY is required for this command");
}

function usage() {
  console.log(`CellFlow CLI 0.2\n\nCommands:\n  doctor\n  intents\n  intent <intentId>\n  reconcile <intentId>\n  evidence <intentId>\n  keys\n  key-create <label>\n  key-revoke <keyId>\n\nEnvironment:\n  CELLFLOW_ENDPOINT   deployed base URL (default http://localhost:3000)\n  CELLFLOW_API_KEY    project API key`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "--help") {
    usage();
  } else if (command === "doctor") {
    const health = await request("/api/health", {}, false);
    let auth = { ok: false, skipped: true };
    if (apiKey) {
      await request("/api/v1/intents?limit=1");
      auth = { ok: true, skipped: false };
    }
    console.log(JSON.stringify({ endpoint, health, auth }, null, 2));
  } else if (command === "intents") {
    requireKey();
    console.log(JSON.stringify(await request("/api/v1/intents"), null, 2));
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
