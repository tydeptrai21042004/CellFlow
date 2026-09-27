#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const outDir = resolve(process.env.CELLFLOW_EVIDENCE_DIR || "evidence/testnet/generated");
const primary = process.env.CKB_RPC_URL?.trim();
const fallbacks = [
  process.env.CKB_RPC_FALLBACK_URL,
  ...(process.env.CKB_RPC_FALLBACK_URLS || "").split(/[\s,]+/),
].map((v) => v?.trim()).filter(Boolean);
const expectedChain = process.env.CKB_NETWORK === "mainnet" ? "ckb" : "ckb_testnet";
const expectedGenesis = process.env.CKB_EXPECTED_GENESIS_HASH?.trim().toLowerCase() || null;

if (!primary) throw new Error("CKB_RPC_URL is required");

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CKB_RPC_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "CellFlow-Evidence/0.3" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function inspect(url, role) {
  const startedAt = new Date().toISOString();
  const [info, genesis, tip] = await Promise.all([
    rpc(url, "get_blockchain_info"),
    rpc(url, "get_block_hash", ["0x0"]),
    rpc(url, "get_tip_header"),
  ]);
  const chain = typeof info?.chain === "string" ? info.chain : null;
  const normalizedGenesis = typeof genesis === "string" ? genesis.toLowerCase() : null;
  const chainMatches = chain === expectedChain;
  const genesisMatches = expectedGenesis ? normalizedGenesis === expectedGenesis : true;
  return {
    role,
    url,
    startedAt,
    observedAt: new Date().toISOString(),
    chain,
    expectedChain,
    chainMatches,
    genesisHash: normalizedGenesis,
    expectedGenesisHash: expectedGenesis,
    genesisMatches,
    tipNumber: tip?.number ?? null,
    initialBlockDownload: info?.is_initial_block_download ?? null,
    ok: chainMatches && genesisMatches,
  };
}

const endpoints = [];
for (const [index, url] of [primary, ...fallbacks].entries()) {
  try {
    endpoints.push(await inspect(url, index === 0 ? "primary" : `fallback-${index}`));
  } catch (error) {
    endpoints.push({
      role: index === 0 ? "primary" : `fallback-${index}`,
      url,
      observedAt: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const document = {
  schemaVersion: "cellflow-testnet-preflight-v1",
  generatedAt: new Date().toISOString(),
  network: process.env.CKB_NETWORK || "testnet",
  expectedChain,
  expectedGenesisHash: expectedGenesis,
  endpointCount: endpoints.length,
  independentEndpointRequirementMet: endpoints.length >= 2,
  allConfiguredEndpointsIdentitySafe: endpoints.every((e) => e.ok === true),
  endpoints,
};
const canonical = JSON.stringify(document, null, 2) + "\n";
const sha256 = createHash("sha256").update(canonical).digest("hex");
const output = { ...document, documentSha256: sha256 };

await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = resolve(outDir, `testnet-preflight-${stamp}.json`);
await writeFile(filename, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });

console.log(JSON.stringify({ output: filename, sha256, ...document }, null, 2));
if (!document.allConfiguredEndpointsIdentitySafe || document.endpointCount < 2) process.exitCode = 2;
