import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../../scripts/ci-install.sh', import.meta.url);

function fixture({ committedLock = false, dryFails = false, installFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cellflow-ci-install-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(script, join(root, 'scripts', 'ci-install.sh'));
  writeFileSync(join(root, 'package.json'), '{"name":"cellflow","private":true,"version":"0.3.0"}\n');
  if (committedLock) writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"name":"cellflow"}\n');
  writeFileSync(join(root, 'bin', 'npm'), `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$MOCK_LOG"
if [[ "$1" == "install" ]]; then
  if [[ "$*" != *--package-lock-only* && "$MOCK_INSTALL_FAIL" == 1 ]]; then exit 47; fi
  printf '{"lockfileVersion":3,"name":"cellflow"}\\n' > package-lock.json
  exit 0
fi
if [[ "$1" == "ci" ]]; then
  if [[ "$*" == *--dry-run* && "$MOCK_DRY_FAIL" == 1 ]]; then exit 1; fi
  exit 0
fi
exit 99
`);
  chmodSync(join(root, 'bin', 'npm'), 0o755);
  const env = {
    ...process.env,
    PATH: join(root, 'bin') + ':' + process.env.PATH,
    MOCK_LOG: join(root, 'calls.txt'),
    MOCK_INSTALL_FAIL: installFails ? '1' : '0',
    MOCK_DRY_FAIL: dryFails ? '1' : '0',
    GITHUB_ENV: join(root, 'github-env.txt'),
    GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
  };
  writeFileSync(env.GITHUB_ENV, '');
  writeFileSync(env.GITHUB_STEP_SUMMARY, '');
  const result = spawnSync('bash', [join(root, 'scripts', 'ci-install.sh')], { cwd: root, env, encoding: 'utf8' });
  const calls = readFileSync(join(root, 'calls.txt'), 'utf8').trim().split('\n');
  const actionsEnv = readFileSync(env.GITHUB_ENV, 'utf8');
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { result, calls, actionsEnv, cleanup };
}

test('committed lockfile enforces a frozen npm ci without updating dependencies', () => {
  const f = fixture({ committedLock: true });
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.deepEqual(f.calls, ['ci --no-audit --no-fund']);
    assert.equal(f.actionsEnv, '');
  } finally { f.cleanup(); }
});

test('absent lockfile installs the full dependency tree before offering a validated artifact', () => {
  const f = fixture();
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.deepEqual(f.calls, [
      'install --no-audit --no-fund',
      'ci --dry-run --ignore-scripts --no-audit --no-fund',
    ]);
    assert.match(f.actionsEnv, /CELLFLOW_EPHEMERAL_LOCKFILE=true/);
    assert.match(f.actionsEnv, /CELLFLOW_VALIDATED_LOCKFILE=true/);
    assert.doesNotMatch(f.calls[0], /package-lock-only/);
  } finally { f.cleanup(); }
});

test('invalid provisional lock does not get advertised as ready to commit', () => {
  const f = fixture({ dryFails: true });
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.deepEqual(f.calls, [
      'install --no-audit --no-fund',
      'ci --dry-run --ignore-scripts --no-audit --no-fund',
      'install --package-lock-only --ignore-scripts --no-audit --no-fund',
      'ci --dry-run --ignore-scripts --no-audit --no-fund',
    ]);
    assert.doesNotMatch(f.actionsEnv, /CELLFLOW_VALIDATED_LOCKFILE/);
    assert.match(f.result.stdout, /not uploading a broken proposed lockfile/);
  } finally { f.cleanup(); }
});

test('npm install failure remains fatal (no misleading successful CI)', () => {
  const f = fixture({ installFails: true });
  try {
    assert.equal(f.result.status, 47);
    assert.deepEqual(f.calls, ['install --no-audit --no-fund']);
    assert.doesNotMatch(f.actionsEnv, /CELLFLOW_VALIDATED_LOCKFILE/);
  } finally { f.cleanup(); }
});
