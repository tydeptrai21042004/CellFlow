import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("funding automation includes safe env generation without wallet secrets", async () => {
  const env = await read(".env.example");
  const generator = await read("scripts/generate-env.sh");
  assert.match(env, /CKB_EXPECTED_GENESIS_HASH=/);
  assert.match(env, /CKB_RPC_FALLBACK_URLS=/);
  assert.match(env, /CELLFLOW_ENCRYPTION_KEY=/);
  assert.doesNotMatch(env, /PRIVATE_KEY|MNEMONIC|SEED_PHRASE/i);
  assert.match(generator, /never in CellFlow \.env files/i);
  assert.match(generator, /chmod 600/);
});

test("Vercel build enforces deterministic regressions while DB tests remain isolated", async () => {
  const config = JSON.parse(await read("vercel.json"));
  const root = JSON.parse(await read("package.json"));
  const installer = await read("scripts/vercel-install.mjs");
  assert.equal(config.installCommand, "node scripts/vercel-install.mjs");
  assert.equal(config.buildCommand, "npm run ci:vercel");
  assert.match(installer, /"ci"/);
  assert.match(installer, /"install"/);
  assert.match(root.scripts["ci:vercel"], /test:vercel-deployment/);
  assert.match(root.scripts["ci:vercel"], /typecheck/);
  assert.match(root.scripts["ci:vercel"], /npm run build/);
  assert.match(root.scripts["test:db-integration"], /db-settlement/);
  assert.match(root.scripts["release:check"], /--strict/);
});

test("evidence scripts label injected proofs and external limitations truthfully", async () => {
  const failover = await read("scripts/evidence/rpc-failover-proof.mjs");
  const restart = await read("scripts/evidence/db-restart-proof.mjs");
  const docs = await read("evidence/testnet/README.md");
  assert.match(failover, /injected-primary-failure/);
  assert.match(failover, /must not be described as a real provider outage/i);
  assert.match(restart, /not a real CKB broadcast\/redeploy proof/i);
  assert.match(docs, /independent application\/maintainer adoption/i);
  assert.match(docs, /external security review/i);
});
