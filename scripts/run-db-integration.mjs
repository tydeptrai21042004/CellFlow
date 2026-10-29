#!/usr/bin/env node
/** Execute the real PostgreSQL suite only after an isolated-database guard. */
import { spawnSync } from 'node:child_process';
import { validateDbTestEnvironment } from './db-test-guard.mjs';

const validation = validateDbTestEnvironment();
if (!validation.ok) {
  console.error('CellFlow database integration tests REFUSED (no database changes made):');
  for (const message of validation.problems) console.error(`- ${message}`);
  process.exitCode = 2;
} else {
  // Both the migration and the tests run against the SAME isolated database.
  const env = { ...process.env, CELLFLOW_REQUIRE_DB_TESTS: 'true' };
  const steps = [
    ['Apply migrations on isolated database', ['scripts/migrate.mjs']],
    ['Run all real PostgreSQL integration tests', [
      '--experimental-transform-types', '--test', '--test-concurrency=1',
      'tests/integration/db-concurrency.test.mjs',
      'tests/integration/db-settlement.test.mjs',
    ]],
  ];
  for (const [label, args] of steps) {
    console.log(`CellFlow: ${label}`);
    const result = spawnSync(process.execPath, args, { env, stdio: 'inherit', shell: false });
    if (result.error) {
      console.error(`CellFlow: command failed: ${result.error.message}`);
      process.exitCode = 1;
      break;
    }
    if (result.signal || result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
  if (!process.exitCode) console.log('CellFlow: all real database integration tests passed.');
}
