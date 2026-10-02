import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const suite = await readFile(new URL("../../scripts/evidence/testnet-live-suite.mjs", import.meta.url), "utf8");
const runner = await readFile(new URL("../../scripts/run-testnet-live-evidence.sh", import.meta.url), "utf8");
const localRunner = await readFile(new URL("../../run_testnet_local_all.sh", import.meta.url), "utf8");
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


test("live suite supports the pinned CCC 1.19.1 constructor API and newer Owner API", () => {
  assert.match(suite, /typeof ccc\.ClientPublicTestnet\?\.open === "function"/);
  assert.match(suite, /new ccc\.ClientPublicTestnet\(urls\[0\]\)/);
  assert.match(suite, /openPublicTestnetClient\(rpcUrls\)/);
});

test("local evidence runner can resume completed expensive stages", () => {
  assert.match(runner, /deterministic\.ok/);
  assert.match(runner, /preflight\.ok/);
  assert.match(runner, /CELLFLOW_LOCAL_RESUME/);
});


test("nested Testnet runner preserves inherited resume directory and credential precedence", async () => {
  const runner = await readFile(new URL("../../scripts/run-testnet-live-evidence.sh", import.meta.url), "utf8");
const localRunner = await readFile(new URL("../../run_testnet_local_all.sh", import.meta.url), "utf8");
  assert.match(runner, /if \[\[ -n "\$\{!key-\}" \]\]; then/);
  assert.match(runner, /outer runner's evidence directory and validated API key/);
});

test("Testnet preflight exposes diagnostics and retries transient endpoint failures", async () => {
  const runner = await readFile(new URL("../../scripts/run-testnet-live-evidence.sh", import.meta.url), "utf8");
const localRunner = await readFile(new URL("../../run_testnet_local_all.sh", import.meta.url), "utf8");
  assert.match(runner, /CELLFLOW_TESTNET_PREFLIGHT_ATTEMPTS/);
  assert.match(runner, /Always print the JSON/);
  assert.match(runner, /Strict Testnet identity preflight failed after/);
});


test("live Testnet chain reads retry transient transport failures and fail over between RPCs", () => {
  assert.match(suite, /CKB_RPC_REQUEST_ATTEMPTS/);
  assert.match(suite, /CKB_RPC_RETRY_DELAY_MS/);
  assert.match(suite, /rpcWithFailover\("get_transaction"/);
  assert.match(suite, /All configured CKB Testnet RPC endpoints failed/);
  assert.match(suite, /rpcRetryable = response\.status === 408/);
  assert.match(suite, /A valid JSON-RPC rejection is an application\/protocol response/);
});


test("live CellFlow/Vercel requests retry transport failures without retrying API responses", async () => {
  const client = await readFile(new URL("../../packages/ccc/src/client.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../../scripts/evidence/testnet-live-reconcile-worker.mjs", import.meta.url), "utf8");
  assert.match(client, /transportRetryAttempts\?: number/);
  assert.match(client, /if \(error instanceof CellFlowHttpError\) throw error/);
  assert.match(client, /AbortSignal\.timeout\(requestTimeoutMs\)/);
  assert.match(suite, /CELLFLOW_HTTP_REQUEST_ATTEMPTS/);
  assert.match(suite, /transportRetryAttempts: cellFlowHttpAttempts/);
  assert.match(worker, /CELLFLOW_HTTP_REQUEST_ATTEMPTS/);
});


test("Testnet evidence prefers IPv4 for WSL/Undici reliability by default", async () => {
  const workerSource = await readFile(new URL("../../scripts/evidence/testnet-live-reconcile-worker.mjs", import.meta.url), "utf8");
  const preflight = await readFile(new URL("../../scripts/evidence/testnet-preflight.mjs", import.meta.url), "utf8");
  assert.match(suite, /setDefaultResultOrder\("ipv4first"\)/);
  assert.match(workerSource, /setDefaultResultOrder\("ipv4first"\)/);
  assert.match(preflight, /setDefaultResultOrder\("ipv4first"\)/);
  assert.match(env, /CELLFLOW_TESTNET_IPV4_FIRST=true/);
});


test("live suite resumes passed blockchain scenarios without spending Testnet CKB again", () => {
  assert.match(suite, /CELLFLOW_TESTNET_RESUME_SCENARIOS/);
  assert.match(suite, /runOrResumeScenario/);
  assert.match(suite, /Live scenario already passed — reusing/);
  assert.match(suite, /30-wallet-input-race\.json/);
});

test("wallet-input race recollects fresh inputs after stale Unknown OutPoint setup errors", () => {
  assert.match(suite, /CELLFLOW_TESTNET_WALLET_SETUP_ATTEMPTS/);
  assert.match(suite, /createWalletSeedCellWithRetry/);
  assert.match(suite, /TransactionFailedToResolve/);
  assert.match(suite, /recollecting wallet inputs/);
  assert.match(suite, /await seedTx\.completeInputsByCapacity\(signer\)/);
});

test("wallet funding race explicitly persists WALLET_FUNDING semantic input roles", () => {
  assert.match(suite, /const walletInputRefs = \[\{ role: "WALLET_FUNDING", outPoint: walletOutPoint \}\]/);
  assert.match(suite, /inputRefs: walletInputRefs/);
  assert.match(suite, /signAndDescribe\(signer, transaction, applicationInputs, inputRefs\)/);
  assert.match(suite, /classifyInputRefs\(inputOutPoints, explicitInputRefs, applicationInputs, originalInputs\)/);
});

test("local runner resumes a failed summary and starts fresh only after passed=true", () => {
  assert.match(localRunner, /summary_passed_true/);
  assert.match(localRunner, /doc\?\.passed === true/);
  assert.match(localRunner, /Resuming previous incomplete\/failed evidence run/);
  assert.match(localRunner, /completed_success/);
});

test("fresh-wallet helper writes private keys locally and exposes only faucet addresses", async () => {
  const helper = await readFile(new URL("../../generate_cellflow_testnet_wallets.sh", import.meta.url), "utf8");
  assert.match(helper, /randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(helper, /CKB_TESTNET_PRIVATE_KEY_A/);
  assert.match(helper, /CKB_TESTNET_PRIVATE_KEY_B/);
  assert.match(helper, /Paste ONLY these PUBLIC ckt1/);
  assert.match(helper, /getBalance\(\)/);
  assert.match(helper, /Both fresh Testnet wallets are funded and ready/);
});
