/**
 * Fail-closed guard for tests that WRITE PostgreSQL records.
 * Allowed targets: a dedicated Neon TEST branch or an ephemeral CI PostgreSQL
 * service on GitHub-hosted runners. Never Vercel Production.
 * This module never prints credentials or a full connection URL.
 */
export function validateDbTestEnvironment(env = process.env) {
  const problems = [];
  const expectedHost = (env.CELLFLOW_DB_TEST_EXPECTED_HOST ?? '').trim().toLowerCase();
  const expectedProductionHost = (env.CELLFLOW_PRODUCTION_DB_HOST ?? '').trim().toLowerCase();
  if (env.CELLFLOW_DB_TEST_ALLOW !== 'true') {
    problems.push('Explicit CELLFLOW_DB_TEST_ALLOW=true is required.');
  }
  const mode = env.CELLFLOW_DB_TEST_CONFIRM_ISOLATED;
  if (mode !== 'isolated-neon-branch' && mode !== 'github-actions-postgres-service') {
    problems.push('Choose isolated-neon-branch or github-actions-postgres-service for CELLFLOW_DB_TEST_CONFIRM_ISOLATED.');
  }
  if (mode === 'github-actions-postgres-service') {
    // This mode never accepts remote URLs. GitHub Actions launches its own
    // disposable service container on localhost, without Neon secrets.
    if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true') {
      problems.push('Ephemeral PostgreSQL service mode requires GitHub Actions CI.');
    }
    if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.CELLFLOW_TESTNET_CI === 'true') {
      problems.push('Database integration tests cannot run in production or Testnet wallet jobs.');
    }
    const validateLocal = (value, name) => {
      try {
        const url = new URL(value ?? '');
        if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
            url.hostname !== '127.0.0.1' || url.port !== '5432' ||
            url.pathname !== '/cellflow_ci' || url.username !== 'cellflow_ci' ||
            !url.password || url.searchParams.get('sslmode') !== 'disable') {
          problems.push(`${name} must target the disposable 127.0.0.1:5432/cellflow_ci PostgreSQL service.`);
        }
        return url;
      } catch {
        problems.push(`${name} is absent or is not a PostgreSQL URL.`);
        return null;
      }
    };
    const pooled = validateLocal(env.DATABASE_URL, 'DATABASE_URL');
    const direct = validateLocal(env.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED');
    if (pooled && direct && pooled.href !== direct.href) {
      problems.push('Both local PostgreSQL URLs must be exactly identical.');
    }
    return { ok: problems.length === 0, problems };
  }
  if (!expectedHost || !/^[a-z0-9.-]+$/.test(expectedHost) || expectedHost.includes('://')) {
    problems.push('Set CELLFLOW_DB_TEST_EXPECTED_HOST to the exact pooled hostname of the isolated test branch.');
  }
  if (!expectedProductionHost || !/^[a-z0-9.-]+$/.test(expectedProductionHost)) {
    problems.push('Set CELLFLOW_PRODUCTION_DB_HOST to the real production hostname for negative isolation checks.');
  }
  if (expectedProductionHost && expectedHost === expectedProductionHost) {
    problems.push('The isolated test host and production host must be different.');
  }
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    problems.push('Database integration tests must never run in a production runtime.');
  }
  if (env.CELLFLOW_TESTNET_CI === 'true') {
    problems.push('Database tests and funded-wallet Testnet tests must be separate jobs.');
  }
  let pooled = null;
  try {
    pooled = new URL(env.DATABASE_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(pooled.protocol) || !pooled.hostname || !pooled.password) {
      problems.push('DATABASE_URL must be a complete PostgreSQL connection URL.');
    }
    if (!pooled.hostname.toLowerCase().endsWith('.neon.tech') || !pooled.hostname.toLowerCase().includes('-pooler.')) {
      problems.push('Test runtime must use an actual Neon pooled hostname.');
    }
    if (pooled.hostname.toLowerCase() !== expectedHost) {
      problems.push('DATABASE_URL hostname does not match the expected isolated test host.');
    }
    if (expectedProductionHost && pooled.hostname.toLowerCase() === expectedProductionHost) {
      problems.push('Test database must not share the production database hostname.');
    }
    if (!['require', 'verify-ca', 'verify-full'].includes(pooled.searchParams.get('sslmode'))) {
      problems.push('Require TLS using sslmode=require (or stronger) for Neon test connections.');
    }
  } catch {
    problems.push('DATABASE_URL is missing or invalid.');
  }
  if (!env.DATABASE_URL_UNPOOLED) {
    problems.push('DATABASE_URL_UNPOOLED is required to migrate the isolated test branch directly.');
  } else {
    try {
      const direct = new URL(env.DATABASE_URL_UNPOOLED);
      const derived = pooled?.hostname.replace('-pooler.', '.').toLowerCase();
      if (direct.hostname.toLowerCase() !== derived || direct.pathname !== pooled?.pathname ||
          direct.username !== pooled?.username || direct.password !== pooled?.password) {
        problems.push('DATABASE_URL_UNPOOLED must identify the same isolated Neon test branch, database and user.');
      }
      if (!['require', 'verify-ca', 'verify-full'].includes(direct.searchParams.get('sslmode'))) {
        problems.push('Direct migration connection must require TLS.');
      }
    } catch {
      problems.push('DATABASE_URL_UNPOOLED is invalid.');
    }
  }
  return { ok: problems.length === 0, problems };
}
