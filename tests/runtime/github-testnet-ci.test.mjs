import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCiTestnetConfig } from '../../scripts/evidence/ci-testnet-config.mjs';
import { writeGithubReport } from '../../scripts/evidence/github-testnet-summary.mjs';
import { committedTxWitness } from '../../scripts/evidence/live-safety.mjs';

const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);
const release = 'c'.repeat(40);
const genesis = `0x${'d'.repeat(64)}`;
const valid = () => ({
  CELLFLOW_TESTNET_CI: 'true',
  CELLFLOW_TESTNET_STRICT_WALLET_ISOLATION: 'true',
  CELLFLOW_TESTNET_REQUIRE_RBF: 'true',
  CKB_NETWORK: 'testnet',
  CELLFLOW_EXPECTED_RELEASE_SHA: release,
  CKB_EXPECTED_GENESIS_HASH: genesis,
  CKB_TESTNET_PRIVATE_KEY_A: keyA,
  CKB_TESTNET_PRIVATE_KEY_B: keyB,
  CELLFLOW_TESTNET_ADDRESS_A: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqf5wntu74dvvhydys0ekc5nmta27q7ed7g03qw8c',
  CELLFLOW_TESTNET_ADDRESS_B: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqdf72483m8lkuvgn50752jw69ny6ywagwgnzqtwj',
  CELLFLOW_API_KEY: `cf_live_${'e'.repeat(42)}`,
  CELLFLOW_URL: 'https://cellflow.example.com',
  CKB_RPC_URL: 'https://rpc-one.example.com/',
  CKB_RPC_FALLBACK_URLS: 'https://rpc-two.example.com/',
});

test('CI gate is independent of any network or wallet and never exposes secret input', () => {
  const env = valid();
  const result = validateCiTestnetConfig(env);
  assert.equal(result.ok, true, result.problems.join('; '));
  for (const secret of [env.CKB_TESTNET_PRIVATE_KEY_A, env.CKB_TESTNET_PRIVATE_KEY_B, env.CELLFLOW_API_KEY]) {
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('CI gate fails closed on wrong network, same wallet, public demo keys, missing SHA and insecure RPC', () => {
  for (const override of [
    { CKB_NETWORK: 'mainnet' },
    { CKB_TESTNET_PRIVATE_KEY_B: keyA },
    { CKB_TESTNET_PRIVATE_KEY_A: '21cc3b4e32a1e9afdd51f54510c816d38bb7be37d40056854a467f4d92ebd96e' },
    { CELLFLOW_EXPECTED_RELEASE_SHA: '' },
    { CKB_EXPECTED_GENESIS_HASH: '' },
    { CKB_RPC_URL: 'http://rpc-one.example.com/' },
    { CELLFLOW_TESTNET_ADDRESS_A: 'ckb1invalid' },
    { CELLFLOW_TESTNET_ADDRESS_B: valid().CELLFLOW_TESTNET_ADDRESS_A },
    { CKB_RPC_FALLBACK_URLS: 'https://rpc-one.example.com/other' },
    { CELLFLOW_API_KEY: '' },
    { CELLFLOW_TESTNET_STRICT_WALLET_ISOLATION: 'false' },
  ]) {
    const result = validateCiTestnetConfig({ ...valid(), ...override });
    assert.equal(result.ok, false, `Expected failure for ${Object.keys(override)[0]}`);
    assert.ok(result.problems.length > 0);
  }
});

test('committed proof requires matching on-chain hash and actual committed status', () => {
  const hash = `0x${'a'.repeat(64)}`;
  const good = [{ ok: true, transaction: { transaction: { hash }, tx_status: { status: 'committed' } } }];
  assert.equal(committedTxWitness(good, hash), true);
  assert.equal(committedTxWitness(good, `0x${'b'.repeat(64)}`), false);
  assert.equal(committedTxWitness([{ ok: true, transaction: { tx_status: { status: 'committed' } } }], hash), false);
  assert.equal(committedTxWitness([{ ok: true, transaction: { transaction: { hash }, tx_status: { status: 'pending' } } }], hash), false);
  assert.equal(committedTxWitness([{ ok: false, transaction: { transaction: { hash }, tx_status: { status: 'committed' } } }], hash), false);
});

test('GitHub failure summary is safe and never turns an incomplete run green', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cellflow-gh-'));
  const raw = join(dir, 'raw'), out = join(dir, 'status');
  try {
    await mkdir(raw);
    await writeFile(join(raw, '99-failure.json'), JSON.stringify({
      error: `privateKey=${keyA} apiKey=cf_live_${'e'.repeat(42)}`,
      scenarios: [{ name: 'two-wallet-same-fee-application-contention', passed: true }],
    }));
    await writeFile(join(raw, '03-wallets.json'), JSON.stringify({
      addressA: 'ckt1example', addressB: 'ckt1example2', balanceA: '100', balanceB: '100',
    }));
    const report = await writeGithubReport(raw, out, null);
    assert.equal(report.status, 'FAILED_OR_INCOMPLETE');
    const published = await readFile(join(out, 'status.json'), 'utf8');
    assert.ok(!published.includes(keyA));
    assert.ok(!published.includes('cf_live_'));
    assert.ok(published.includes('ckt1example'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('one workflow isolates safe CI on PR/push from manually dispatched strict live spends', async () => {
  const yaml = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const bash = await readFile(new URL('../../scripts/run-testnet-live-evidence.sh', import.meta.url), 'utf8');
  const suite = await readFile(new URL('../../scripts/evidence/testnet-live-suite.mjs', import.meta.url), 'utf8');
  assert.match(yaml, /push:\s*\n\s*branches: \[main\]/);
  assert.match(yaml, /pull_request:/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /needs: ci/);
  assert.match(yaml, /github.event_name == 'workflow_dispatch'/);
  assert.match(yaml, /github.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /inputs.run_live_testnet == true/);
  assert.match(yaml, /environment: ckb-testnet/);
  assert.match(yaml, /CELLFLOW_TESTNET_STRICT_WALLET_ISOLATION: 'true'/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(yaml, /evidence\/package-review-bundle\.mjs/);
  assert.match(yaml, /if: success\(\)/);
  assert.match(yaml, /if: always\(\)/);
  assert.match(yaml, /CELLFLOW_TESTNET_ADDRESS_A:/);
  assert.match(yaml, /CELLFLOW_TESTNET_ADDRESS_B:/);
  assert.match(bash, /CELLFLOW_TESTNET_CI/);
  assert.match(bash, /ci-testnet-config\.mjs/);
  assert.match(suite, /Signing-key \/ hard-coded funding-address mismatch/);
  assert.doesNotMatch(yaml, /CKB_TESTNET_PRIVATE_KEY_A: ['"]?0x[0-9a-f]{64}/i);
});

test('single workflow keeps push/PR and funded Testnet jobs free of database secrets', async () => {
  const yaml = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const { readdir } = await import('node:fs/promises');
  const workflowFiles = (await readdir(new URL('../../.github/workflows/', import.meta.url)))
    .filter(name => /\.ya?ml$/.test(name));
  assert.deepEqual(workflowFiles, ['ci.yml']);
  const ciJob = yaml.split('\n  ci:\n')[1]?.split('\n  db_postgres:\n')[0];
  const pgJob = yaml.split('\n  db_postgres:\n')[1]?.split('\n  db_integration:\n')[0];
  const testnetJob = yaml.split('\n  testnet:\n')[1];
  assert.ok(ciJob && pgJob && testnetJob);
  assert.doesNotMatch(ciJob, /DATABASE_URL:/);
  assert.doesNotMatch(testnetJob, /DATABASE_URL:/);
  assert.match(yaml, /environment: cellflow-db-integration/);
  assert.match(yaml, /inputs\.run_db_integration == true/);
  assert.match(yaml, /CELLFLOW_TEST_DATABASE_URL/);
  assert.doesNotMatch(yaml, /secrets\.DATABASE_URL/);
  assert.match(pgJob, /^\s+services:\s*$/m);
  assert.doesNotMatch(ciJob, /^\s+services:\s*$/m);
  assert.doesNotMatch(testnetJob, /^\s+services:\s*$/m);
  assert.doesNotMatch(pgJob, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(ciJob, /^\s+run:.*npm run (?:migrate|test:db-integration)/m);
  assert.match(yaml, /npm run test:github-offline/);
  assert.match(yaml, /npm run release:check/);
  assert.match(yaml, /CELLFLOW_URL: \$\{\{ vars\.CELLFLOW_URL/);
  assert.doesNotMatch(yaml, /Upload generated lockfile for later commit/);
  assert.match(yaml, /npm install --package-lock=false --no-audit --no-fund/);
  assert.match(yaml, /Publish safe status summary even when failing/);
});


test('missing lockfile installs with npm install directly, without an invalid temporary workspace lock', async () => {
  const yaml = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(yaml, /npm install --package-lock=false --no-audit --no-fund/);
  assert.match(yaml, /if \[\[ -f package-lock\.json \]\]; then/);
  assert.match(yaml, /npm ci --no-audit --no-fund/);
  assert.doesNotMatch(yaml, /npm install --package-lock-only/);
  assert.doesNotMatch(yaml, /cellflow-proposed-lockfile/);
  assert.match(yaml, /CELLFLOW_TEST_DATABASE_URL/);
  assert.match(yaml, /cellflow-db-integration/);
  assert.match(yaml, /services:\s*\n\s+postgres:\s*\n\s+image: postgres:16/);
});

test('automatic Postgres CI job uses disposable local service without Neon or production secrets', async () => {
  const yaml = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = yaml.split('\n  db_postgres:\n')[1]?.split('\n  db_integration:\n')[0];
  assert.ok(job);
  assert.match(job, /needs: ci/);
  assert.match(job, /postgres:16/);
  assert.match(job, /POSTGRES_DB: cellflow_ci/);
  assert.match(job, /127\.0\.0\.1:5432\/cellflow_ci/);
  assert.match(job, /CELLFLOW_DB_TEST_CONFIRM_ISOLATED: github-actions-postgres-service/);
  assert.match(job, /npm run test:db-integration/);
  assert.doesNotMatch(job, /\n\s+if:\s*\$\{\{ github\.event_name/);
  assert.doesNotMatch(job, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(job, /neon\.tech|cellflow-brown\.vercel\.app/i);
});

test('release gate does not require env template files or a database in GitHub Actions', async () => {
  const code = await readFile(new URL('../../scripts/release-preflight.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /file:\.?env\./);
  assert.doesNotMatch(code, /env-template:/);
  assert.match(code, /readyForGithubOfflineCI:/);
  assert.match(code, /dependency-lockfile/);
});
