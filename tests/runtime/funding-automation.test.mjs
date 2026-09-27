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

test("CI makes lockfile, migrations, DB races, build and strict preflight public gates", async () => {
  const ci = await read(".github/workflows/ci.yml");
  for (const expected of [
    "test -s package-lock.json",
    "npm ci",
    "npm run migrate",
    "npm run test:db-integration",
    "npm run build",
    "npm run release:check",
  ]) assert.match(ci, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
