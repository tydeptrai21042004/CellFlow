#!/usr/bin/env node
/** Verify a deployed Vercel CellFlow readiness response against an exact SHA. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/i;
export function assertDeployedReadiness({ expectedSha, httpStatus, body }) {
  if (!SHA.test(expectedSha ?? "")) throw new Error("Supply the full expected 40-character Git commit SHA");
  if (httpStatus !== 200 || body?.ok !== true || body?.status?.code !== "READY") {
    throw new Error(`Hosted readiness is not healthy (HTTP ${httpStatus}; status ${body?.status?.code ?? "unknown"})`);
  }
  if (!SHA.test(body.releaseSha ?? "") || body.releaseSha.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error(`Deployed SHA mismatch (observed ${body?.releaseSha ?? "missing"}, expected ${expectedSha})`);
  }
  return { releaseSha: body.releaseSha, healthy: true, version: body.version, checkedAt: new Date().toISOString() };
}

export async function verifyLive({ origin, expectedSha, fetchImpl = fetch }) {
  const address = new URL(origin);
  if (address.protocol !== "https:" && !(address.protocol === "http:" && ["localhost", "127.0.0.1"].includes(address.hostname))) {
    throw new Error("Deployment URL must be HTTPS (localhost HTTP is permitted for development)");
  }
  if (address.username || address.password || address.search || address.hash || !["", "/"].includes(address.pathname)) {
    throw new Error("Supply a clean deployment origin without credentials, paths, query or fragment");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(`${address.origin}/api/ready`, { headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" });
    const size = Number(response.headers?.get?.("content-length") ?? "0");
    if (size > 128000) throw new Error("Readiness response exceeds size limit");
    const payload = await response.text();
    if (payload.length > 128000) throw new Error("Readiness payload exceeds size limit");
    let body;
    try { body = JSON.parse(payload); } catch { throw new Error("Readiness response is not JSON"); }
    return assertDeployedReadiness({ expectedSha, httpStatus: response.status, body });
  } finally { clearTimeout(timeout); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const origin = process.argv[2] || process.env.CELLFLOW_URL;
  const expectedSha = process.argv[3] || process.env.CELLFLOW_EXPECTED_RELEASE_SHA;
  if (!origin || !expectedSha) {
    console.error("Usage: npm run verify:deployment -- https://cellflow-brown.vercel.app <40-character-sha>");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await verifyLive({ origin, expectedSha }), null, 2));
    } catch (error) {
      console.error(`Deployment verification FAILED: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
