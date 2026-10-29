import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateDbTestEnvironment } from '../../scripts/db-test-guard.mjs';

// Synthetic data only. Never use a real credential in a unit test.
const sample = () => ({
  CELLFLOW_DB_TEST_ALLOW: 'true',
  CELLFLOW_DB_TEST_CONFIRM_ISOLATED: 'isolated-neon-branch',
  CELLFLOW_DB_TEST_EXPECTED_HOST: 'ep-isolated-test-pooler.us-east-1.aws.neon.tech',
  CELLFLOW_PRODUCTION_DB_HOST: 'ep-prod-pooler.us-east-1.aws.neon.tech',
  DATABASE_URL: 'postgresql://test_user:synthetic@ep-isolated-test-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
  DATABASE_URL_UNPOOLED: 'postgresql://test_user:synthetic@ep-isolated-test.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

test('isolated pooled + matching direct Neon URL passes without querying Postgres', () => {
  assert.deepEqual(validateDbTestEnvironment(sample()), { ok: true, problems: [] });
});

test('database guard rejects absent approval, wrong host and production settings', () => {
  for (const changes of [
    { CELLFLOW_DB_TEST_ALLOW: undefined },
    { CELLFLOW_DB_TEST_CONFIRM_ISOLATED: 'yes' },
    { CELLFLOW_DB_TEST_EXPECTED_HOST: 'some-other-host.neon.tech' },
    { CELLFLOW_PRODUCTION_DB_HOST: undefined },
    { CELLFLOW_PRODUCTION_DB_HOST: sample().CELLFLOW_DB_TEST_EXPECTED_HOST },
    { VERCEL_ENV: 'production' },
    { NODE_ENV: 'production' },
    { CELLFLOW_TESTNET_CI: 'true' },
    { DATABASE_URL: 'postgresql://test_user:synthetic@ep-prod-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require' },
    { DATABASE_URL_UNPOOLED: 'postgresql://test_user:synthetic@ep-wrong.us-east-1.aws.neon.tech/neondb?sslmode=require' },
    { DATABASE_URL_UNPOOLED: undefined, DATABASE_URL: undefined },
    { DATABASE_URL_UNPOOLED: undefined },
    { DATABASE_URL_UNPOOLED: undefined, DATABASE_URL: 'postgresql://test_user:synthetic@ep-isolated-test-pooler.us-east-1.aws.neon.tech/neondb' },
  ]) {
    const result = validateDbTestEnvironment({ ...sample(), ...changes });
    assert.equal(result.ok, false, `Expected refusal for ${JSON.stringify(Object.keys(changes))}`);
    assert.ok(result.problems.length);
    assert.ok(!JSON.stringify(result).includes('synthetic'), 'Guard must not echo credentials');
  }
});

test('default npm database test entrypoint fails closed without touching a database', () => {
  const child = spawnSync(process.execPath, ['scripts/run-db-integration.mjs'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CELLFLOW_DB_TEST_ALLOW: 'false' },
  });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /REFUSED/);
  assert.doesNotMatch(child.stderr, /postgresql:\/\//);
});

const postgresService = () => ({
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  CELLFLOW_DB_TEST_ALLOW: 'true',
  CELLFLOW_DB_TEST_CONFIRM_ISOLATED: 'github-actions-postgres-service',
  DATABASE_URL: 'postgresql://cellflow_ci:synthetic@127.0.0.1:5432/cellflow_ci?sslmode=disable',
  DATABASE_URL_UNPOOLED: 'postgresql://cellflow_ci:synthetic@127.0.0.1:5432/cellflow_ci?sslmode=disable',
});

test('GitHub Actions ephemeral PostgreSQL service is accepted', () => {
  assert.deepEqual(validateDbTestEnvironment(postgresService()), {ok: true, problems: []});
});

test('GitHub Actions service mode rejects production, remote DBs, or wrong DB and user', () => {
  for (const changes of [
    { CI: undefined },
    { GITHUB_ACTIONS: undefined },
    { CELLFLOW_DB_TEST_ALLOW: undefined },
    { NODE_ENV: 'production' },
    { VERCEL_ENV: 'production' },
    { CELLFLOW_TESTNET_CI: 'true' },
    { DATABASE_URL: 'postgresql://cellflow_ci:synthetic@db.example.org:5432/cellflow_ci?sslmode=disable' },
    { DATABASE_URL: 'postgresql://prod:synthetic@127.0.0.1:5432/cellflow_ci?sslmode=disable' },
    { DATABASE_URL: 'postgresql://cellflow_ci:synthetic@127.0.0.1:5432/production?sslmode=disable' },
    { DATABASE_URL: 'postgresql://cellflow_ci:synthetic@127.0.0.1:5432/cellflow_ci?sslmode=require' },
    { DATABASE_URL_UNPOOLED: undefined },
    { DATABASE_URL_UNPOOLED: 'postgresql://cellflow_ci:other@127.0.0.1:5432/cellflow_ci?sslmode=disable' },
  ]) {
    const result = validateDbTestEnvironment({...postgresService(), ...changes});
    assert.equal(result.ok, false, `Should reject ${JSON.stringify(Object.keys(changes))}`);
    assert.ok(!JSON.stringify(result).includes('synthetic'));
  }
});
