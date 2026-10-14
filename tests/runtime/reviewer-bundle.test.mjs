import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { redactEvidence, redactString } from "../../scripts/evidence/package-review-bundle.mjs";

const script = resolve(new URL("../../scripts/evidence/package-review-bundle.mjs", import.meta.url).pathname);
const sha = "a".repeat(40);
const scenarioFiles = ["10-two-wallet-same-fee-race.json", "20-two-wallet-higher-fee-rbf.json",
  "30-wallet-input-race.json", "40-ambiguous-recovery.json"];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "cellflow-review-"));
  const source = join(root, "source"), output = join(root, "review");
  await mkdir(source);
  const docs = {
    "01-network.json": [{ chain: "ckb_testnet", ok: true, genesisHash: "0x123" }, { chain: "ckb_testnet", ok: true, genesisHash: "0x123" }],
    "02-cellflow-readiness.json": { ok: true, releaseSha: sha },
    "90-project-evidence.json": { evidence: { project: { network: "testnet" }, release: { commitSha: sha } } },
    "99-summary.json": { passed: true, runId: "fixture", scenarios: scenarioFiles.map(file => ({ name: file, passed: true })) },
    "10-two-wallet-same-fee-race.json": { result: { passed: true }, apiKey: "secret material", txHash: `0x${"aa".repeat(32)}` },
    "20-two-wallet-higher-fee-rbf.json": { result: { passed: true } },
    "30-wallet-input-race.json": { result: { passed: true } },
    "40-ambiguous-recovery.json": { result: { passed: true }, nested: { authorization: "Bearer secret", url: "https://rpc.example/rpc?token=oops" } },
  };
  for (const [name, doc] of Object.entries(docs)) await writeFile(join(source, name), JSON.stringify(doc));
  return { root, source, output };
}
function command(...args) { return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" }); }

test("redaction removes credential-like fields and URL secrets without erasing public tx hashes", () => {
  const txHash = `0x${"bb".repeat(32)}`;
  const sanitized = redactEvidence({ privateKey: "bad", bearerToken: "bad", evidence: [{ txHash, nested: { dbPassword: "bad" } }] });
  assert.equal(sanitized.privateKey, "[REDACTED]");
  assert.equal(sanitized.bearerToken, "[REDACTED]");
  assert.equal(sanitized.evidence[0].nested.dbPassword, "[REDACTED]");
  assert.equal(sanitized.evidence[0].txHash, txHash);
  assert.doesNotMatch(redactString("https://alice:pass@rpc.example/rpc?api_key=abc"), /alice|pass|api_key=abc/);
});

test("bundle pins same full deployed SHA and packages verifiable redacted artifacts", async () => {
  const fixture = await setup();
  try {
    let result = command("--source", fixture.source, "--out", fixture.output, "--sha", sha);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(fixture.output, "manifest.json"), "utf8"));
    assert.equal(manifest.releaseSha, sha);
    const scenario = JSON.parse(await readFile(join(fixture.output, scenarioFiles[0]), "utf8"));
    assert.equal(scenario.apiKey, "[REDACTED]");
    assert.equal(scenario.txHash, `0x${"aa".repeat(32)}`);
    result = command("--verify", fixture.output);
    assert.equal(result.status, 0, result.stderr);
    await writeFile(join(fixture.output, scenarioFiles[0]), "{}");
    result = command("--verify", fixture.output);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Checksum mismatch/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("bundle refuses unsupported SHA, incomplete scenario, or false PASS claims", async () => {
  const fixture = await setup();
  try {
    assert.equal(command("--source", fixture.source, "--out", fixture.output, "--sha", "b".repeat(40)).status, 2);
    await writeFile(join(fixture.source, "99-summary.json"), JSON.stringify({ passed: false, scenarios: [] }));
    assert.equal(command("--source", fixture.source, "--out", fixture.output, "--sha", sha).status, 2);
    await rm(join(fixture.source, "40-ambiguous-recovery.json"));
    assert.equal(command("--source", fixture.source, "--out", fixture.output, "--sha", sha).status, 2);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
