#!/usr/bin/env node
/**
 * Deterministic, credential-free packaging of already-collected CellFlow
 * Testnet evidence. Never broadcasts and never claims the tests were run here.
 * Requires a completed run with deployed release SHA pinned by the operator.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const required = [
  "01-network.json", "02-cellflow-readiness.json", "10-two-wallet-same-fee-race.json",
  "20-two-wallet-higher-fee-rbf.json", "30-wallet-input-race.json",
  "40-ambiguous-recovery.json", "90-project-evidence.json", "99-summary.json",
];
const optional = ["00-testnet-preflight.json", "03-wallets.json"];
const SHA = /^[a-f0-9]{40}$/i;
const SENSITIVE_KEY = /(?:private.?key|api.?key|bearer|authorization|password|secret|mnemonic|seed.?phrase|cookie|credential|database.?url|access.?token|refresh.?token|signature.?key|signing.?key|encrypted)/i;
const SENSITIVE_VALUE = /(?:cf_live_[A-Za-z0-9_-]{20,}|whsec_[A-Za-z0-9_-]{20,}|\bBearer\s+[A-Za-z0-9._~+/-]{12,})/gi;
const URL_CREDENTIAL_PARAM = /(?:token|key|secret|password|authorization|auth|signature|credential)/i;

export function redactString(value) {
  let sanitized = value.replace(SENSITIVE_VALUE, "[REDACTED]");
  // Avoid publishing URL userinfo/query parameters even when they're embedded
  // in diagnostic strings, without altering public transaction identifiers.
  sanitized = sanitized.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const parsed = new URL(candidate);
      if (parsed.username || parsed.password) {
        parsed.username = "REDACTED";
        parsed.password = "";
      }
      for (const key of parsed.searchParams.keys()) {
        if (URL_CREDENTIAL_PARAM.test(key)) parsed.searchParams.set(key, "REDACTED");
      }
      return parsed.toString();
    } catch { return candidate; }
  });
  return sanitized;
}

export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactEvidence(item),
    ]));
  }
  return typeof value === "string" ? redactString(value) : value;
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function assertSafeSha(value, message) {
  if (!SHA.test(value ?? "")) throw new Error(`${message}: require the full 40-character deployed commit SHA`);
  return value.toLowerCase();
}
function jsonText(data) { return JSON.stringify(data, null, 2) + "\n"; }
async function readJson(folder, name) {
  const data = await readFile(join(folder, name), "utf8");
  return JSON.parse(data);
}

async function verify(folder) {
  const manifest = await readJson(folder, "manifest.json");
  const text = await readFile(join(folder, "SHA256SUMS"), "utf8");
  const lines = text.trim().split("\n");
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (!match) throw new Error(`Invalid checksum entry: ${line}`);
    const [, expected, name] = match;
    if (sha256(await readFile(join(folder, name))) !== expected) throw new Error(`Checksum mismatch: ${name}`);
  }
  if (manifest.schemaVersion !== "cellflow-review-bundle-v1" || !SHA.test(manifest.releaseSha)) {
    throw new Error("Invalid bundle manifest");
  }
  console.log(`VERIFIED ${lines.length} artifacts for ${manifest.releaseSha}`);
}

async function create(source, output, expectedSha) {
  if (resolve(source) === resolve(output)) throw new Error("Source and output directories must differ");
  const documents = new Map();
  for (const name of required) documents.set(name, await readJson(source, name));
  for (const name of optional) {
    try { documents.set(name, await readJson(source, name)); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  const readiness = documents.get("02-cellflow-readiness.json");
  const network = documents.get("01-network.json");
  const summary = documents.get("99-summary.json");
  const projectExport = documents.get("90-project-evidence.json");
  const releaseSha = assertSafeSha(readiness?.releaseSha, "Readiness response");
  if (releaseSha !== expectedSha) throw new Error(`Deployed release mismatch: observed ${releaseSha}, expected ${expectedSha}`);
  if (readiness.ok !== true) throw new Error("Readiness snapshot was not healthy");
  if (!Array.isArray(network) || network.length < 2 || !network.every(e => e?.ok === true && e?.chain === "ckb_testnet")) {
    throw new Error("Missing independent CKB Testnet RPC identity evidence");
  }
  if (network.some(e => String(e?.genesisHash ?? "").toLowerCase() !== String(network[0]?.genesisHash ?? "").toLowerCase())) {
    throw new Error("RPC genesis mismatch across endpoints");
  }
  if (summary?.passed !== true || !Array.isArray(summary?.scenarios) ||
      summary.scenarios.length < 4 || !summary.scenarios.every(s => s.passed === true)) {
    throw new Error("Live Testnet suite was not fully successful");
  }
  const projectRelease = projectExport?.evidence?.release?.commitSha ?? projectExport?.release?.commitSha;
  if (assertSafeSha(projectRelease, "Project evidence release") !== releaseSha) {
    throw new Error("Project evidence release SHA does not match hosted readiness");
  }
  const projectNetwork = projectExport?.evidence?.project?.network ?? projectExport?.project?.network;
  if (projectNetwork !== "testnet") throw new Error("Project evidence is not Testnet-scoped");
  for (const name of required.filter(name => /^\d\d-/.test(name) && !["01-network.json", "02-cellflow-readiness.json", "90-project-evidence.json", "99-summary.json"].includes(name))) {
    const scenario = documents.get(name);
    if (scenario?.result?.passed !== true) throw new Error(`${name} has no PASS result`);
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  const artifacts = [];
  for (const [name, document] of documents) {
    const sanitized = redactEvidence(document);
    const text = jsonText(sanitized);
    await writeFile(join(output, name), text, { mode: 0o600 });
    artifacts.push({ file: name, sha256: sha256(text), bytes: Buffer.byteLength(text) });
  }
  const manifest = {
    schemaVersion: "cellflow-review-bundle-v1",
    evidenceKind: "recorded-real-testnet",
    releaseSha,
    runId: summary.runId ?? null,
    recordedStartedAt: summary.startedAt ?? null,
    recordedFinishedAt: summary.finishedAt ?? null,
    network: "testnet",
    genesisHash: network[0]?.genesisHash ?? null,
    recordedScenarios: summary.scenarios,
    artifacts,
    limitations: [
      "Only supplied run artifacts are packaged; this command does not execute RPC or recovery tests.",
      "Checksums prove packaged-byte integrity, not chain truth or deployment ownership.",
      "The review bundle excludes unverified restart/reorg/webhook delivery claims unless separately documented.",
      "Endpoint names and public addresses can identify Testnet activity; review before sharing.",
    ],
  };
  const manifestText = jsonText(manifest);
  await writeFile(join(output, "manifest.json"), manifestText, { mode: 0o600 });
  const readme = `# CellFlow reviewer bundle\n\nDeployed SHA: \`${releaseSha}\`\nRun ID: \`${summary.runId ?? "unknown"}\`\n\n` +
    `Review \`manifest.json\`, then run \`sha256sum -c SHA256SUMS\`.\n` +
    `The recorded scenarios come from the source evidence directory; no tests were run by this packager.\n` +
    `Private credentials are redacted conservatively; inspect JSON files manually before making them public.\n` +
    `Additional DB/webhook or fork evidence must be published separately and explicitly identified.\n`;
  await writeFile(join(output, "README.md"), readme, { mode: 0o600 });
  const checksumFiles = [...artifacts.map(({ file, sha256 }) => `${sha256}  ${file}`),
    `${sha256(manifestText)}  manifest.json`, `${sha256(readme)}  README.md`].sort();
  await writeFile(join(output, "SHA256SUMS"), checksumFiles.join("\n") + "\n", { mode: 0o600 });
  await verify(output);
  console.log(`Prepared reviewer bundle: ${output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const verifyDir = flag("--verify");
    if (verifyDir) await verify(resolve(verifyDir));
    else {
      const src = flag("--source");
      const out = flag("--out");
      const sha = assertSafeSha(flag("--sha"), "Expected release");
      if (!src || !out) throw new Error("Usage: node scripts/evidence/package-review-bundle.mjs --source RUN_DIR --out REVIEW_DIR --sha FULL_40_CHAR_SHA\n       node scripts/evidence/package-review-bundle.mjs --verify REVIEW_DIR");
      await create(resolve(src), resolve(out), sha);
    }
  } catch (error) { console.error(`Bundle rejected: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
