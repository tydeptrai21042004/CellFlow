import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const suite = await readFile(new URL("../../scripts/evidence/testnet-live-suite.mjs", import.meta.url), "utf8");
const runner = await readFile(new URL("../../scripts/run-testnet-live-evidence.sh", import.meta.url), "utf8");
const env = await readFile(new URL("../../.env.testnet.example", import.meta.url), "utf8");
const server = await readFile(new URL("../../apps/web/lib/server.ts", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

const KEY_A = "21cc3b4e32a1e9afdd51f54510c816d38bb7be37d40056854a467f4d92ebd96e";
const KEY_B = "3fc54dc0e24080697472c447dc38557adb69fad0289d917fdbd4445c9653776b";
const DERIVATION_DOMAIN = "cellflow:auto-bootstrap:initial-admin:v1";

test("live Testnet harness is an explicit two-wallet, Testnet-only evidence path", () => {
  assert.match(suite, /KnownScript\.AlwaysSuccess/);
  assert.match(suite, /two-wallet-same-fee-application-contention/);
  assert.match(suite, /two-wallet-higher-fee-rbf/);
  assert.match(suite, /wallet-funding-input-conflict/);
  assert.match(suite, /INJECTED_LOST_RESPONSE/);
  assert.match(suite, /RBF_REPLACEMENT/);
  assert.match(suite, /REBUILD_FROM_LIVE_STATE/);
  assert.match(suite, /RECOLLECT_WALLET_INPUTS/);
  assert.match(suite, /signedPayloadHashSha256/);
  assert.match(suite, /SHA256SUMS/);
  assert.match(runner, /CKB_NETWORK.*testnet/);
  assert.equal(pkg.scripts["validate:testnet-live"], "bash scripts/run-testnet-live-evidence.sh");
});

test("default Testnet identities and operational defaults require no duplicate signer setup", () => {
  assert.match(suite, new RegExp(KEY_A));
  assert.match(suite, new RegExp(KEY_B));
  assert.match(suite, /DEFAULT_CELLFLOW_URL = "https:\/\/cellflow-brown\.vercel\.app"/);
  assert.match(suite, /DEFAULT_PRIMARY_RPC = "https:\/\/testnet\.ckbapp\.dev\/rpc"/);
  assert.match(suite, /DEFAULT_FALLBACK_RPC = "https:\/\/testnet\.ckb\.dev\/"/);
  assert.match(env, /built-in,\n# public development Testnet identities|built-in,/i);
  assert.doesNotMatch(env, /^CKB_TESTNET_PRIVATE_KEY_[AB]=[0-9a-f]{64}$/m);
});

test("runner reuses bootstrap credentials instead of requiring a separate CellFlow API key", () => {
  assert.match(suite, /CELLFLOW_INITIAL_ADMIN_API_KEY/);
  assert.match(suite, /CELLFLOW_BOOTSTRAP_TOKEN/);
  assert.match(suite, new RegExp(DERIVATION_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(server, new RegExp(DERIVATION_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(runner, /CELLFLOW_INITIAL_ADMIN_API_KEY/);
  assert.match(runner, /CELLFLOW_BOOTSTRAP_TOKEN/);
  assert.match(runner, /no separate CELLFLOW_API_KEY is required/);
});

test("live suite never serializes private-key variables or API credentials into evidence documents", () => {
  assert.doesNotMatch(suite, /saveJson\([^\n]+privateKeyA/);
  assert.doesNotMatch(suite, /saveJson\([^\n]+privateKeyB/);
  assert.doesNotMatch(suite, /JSON\.stringify\([^\n]+apiKey/);
  assert.doesNotMatch(suite, /saveJson\([^\n]+bootstrapToken/);
});
