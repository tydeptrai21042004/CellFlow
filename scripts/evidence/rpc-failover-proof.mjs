#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CkbRpcClient, parseRpcUrls } from "../../workflows/reconcile/src/rpc.ts";

const configured = parseRpcUrls(
  process.env.CKB_RPC_URL,
  process.env.CKB_RPC_FALLBACK_URL,
  process.env.CKB_RPC_FALLBACK_URLS,
);
if (configured.length < 2) {
  throw new Error("Funding proof requires CKB_RPC_URL plus at least one independent fallback RPC endpoint");
}

const expectedChain = process.env.CKB_NETWORK === "mainnet" ? "ckb" : "ckb_testnet";
const expectedGenesis = process.env.CKB_EXPECTED_GENESIS_HASH?.toLowerCase() || null;

async function identity(url) {
  const client = new CkbRpcClient([url]);
  const info = await client.getBlockchainInfo();
  const genesis = await client.getGenesisHash();
  return {
    url,
    chain: info?.chain ?? null,
    genesisHash: genesis?.toLowerCase() ?? null,
    chainMatches: info?.chain === expectedChain,
    genesisMatches: expectedGenesis ? genesis?.toLowerCase() === expectedGenesis : true,
  };
}

const endpointIdentity = [];
for (const url of configured) endpointIdentity.push(await identity(url));
if (endpointIdentity.some((x) => !x.chainMatches || !x.genesisMatches)) {
  throw new Error("At least one configured RPC endpoint failed network/genesis identity validation");
}

// Deliberately inject an unusable first endpoint while keeping the real configured
// fallback as endpoint #2. This tests CellFlow's actual failover path without
// pretending that the injected failure was a real provider outage.
const injectedPrimary = process.env.CELLFLOW_FAILOVER_INJECT_URL || "https://127.0.0.1:1/rpc";
const fallback = configured[1];
const client = new CkbRpcClient([injectedPrimary, fallback]);
const startedAt = new Date().toISOString();
const info = await client.getBlockchainInfo();
const genesis = await client.getGenesisHash();
const observedAt = new Date().toISOString();

const proof = {
  schemaVersion: "cellflow-rpc-failover-proof-v1",
  generatedAt: observedAt,
  mode: "injected-primary-failure",
  note: "This artifact proves the CellFlow fallback path. It must not be described as a real provider outage unless the primary provider was actually unavailable.",
  configuredEndpoints: configured,
  endpointIdentity,
  injectedPrimary,
  fallbackUsedForProof: fallback,
  result: {
    chain: info?.chain ?? null,
    genesisHash: genesis?.toLowerCase() ?? null,
    chainMatches: info?.chain === expectedChain,
    genesisMatches: expectedGenesis ? genesis?.toLowerCase() === expectedGenesis : true,
    startedAt,
    observedAt,
  },
};
const body = JSON.stringify(proof, null, 2) + "\n";
const sha256 = createHash("sha256").update(body).digest("hex");
const output = { ...proof, documentSha256: sha256 };

const outDir = resolve(process.env.CELLFLOW_EVIDENCE_DIR || "evidence/testnet/generated");
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = resolve(outDir, `rpc-failover-${stamp}.json`);
await writeFile(filename, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output: filename, sha256, proof: output }, null, 2));

if (!output.result.chainMatches || !output.result.genesisMatches) process.exitCode = 2;
