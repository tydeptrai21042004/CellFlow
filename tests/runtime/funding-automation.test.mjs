import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("funding automation generates a private env without templates or wallet keys", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "cellflow-generated-env-"));
  const output = join(dir, ".env.local");
  try {
    const result = spawnSync("bash", ["scripts/generate-env.sh"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CELLFLOW_ENV_OUTPUT: output,
        CKB_EXPECTED_GENESIS_HASH: `0x${"1".repeat(64)}`,
        // Ensure a standalone test, not a copy of external machine secrets.
        CELLFLOW_ENCRYPTION_KEY: "",
        CELLFLOW_BOOTSTRAP_TOKEN: "",
        CRON_SECRET: "",
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const env = await readFile(output, "utf8");
    for (const key of ["CKB_EXPECTED_GENESIS_HASH", "CKB_RPC_FALLBACK_URLS", "CELLFLOW_ENCRYPTION_KEY", "CELLFLOW_BOOTSTRAP_TOKEN"]) {
      assert.match(env, new RegExp(`^${key}='[^']*'$`, "m"));
    }
    for (const key of ["CELLFLOW_ENCRYPTION_KEY", "CELLFLOW_BOOTSTRAP_TOKEN", "CRON_SECRET"]) {
      assert.match(env, new RegExp(`^${key}='[0-9a-f]{64}'$`, "m"));
    }
    const encryption = env.match(/^CELLFLOW_ENCRYPTION_KEY='([^']+)'$/m)?.[1];
    const bootstrap = env.match(/^CELLFLOW_BOOTSTRAP_TOKEN='([^']+)'$/m)?.[1];
    assert.notEqual(encryption, bootstrap, "bootstrap token and encryption key must be independent");
    assert.doesNotMatch(env, /^CKB_TESTNET_PRIVATE_KEY_[AB]=|^MNEMONIC=|^SEED_PHRASE=/m);
    assert.equal((await stat(output)).mode & 0o777, 0o600, "generated env must remain owner-only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const generator = await read("scripts/generate-env.sh");
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
  // The public npm script intentionally delegates to a fail-closed runner.
  // Validate the runner rather than requiring test file names in package.json.
  assert.match(root.scripts["test:db-integration"], /scripts\/run-db-integration\.mjs/);
  const dbRunner = await read("scripts/run-db-integration.mjs");
  assert.match(dbRunner, /validateDbTestEnvironment/);
  assert.match(dbRunner, /scripts\/migrate\.mjs/);
  assert.match(dbRunner, /tests\/integration\/db-concurrency\.test\.mjs/);
  assert.match(dbRunner, /tests\/integration\/db-settlement\.test\.mjs/);
  assert.match(dbRunner, /CELLFLOW_REQUIRE_DB_TESTS/);
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
