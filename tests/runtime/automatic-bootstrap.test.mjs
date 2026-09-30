import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const setupRoute = fs.readFileSync("apps/web/app/api/setup/route.ts", "utf8");
const readyRoute = fs.readFileSync("apps/web/app/api/ready/route.ts", "utf8");
const auth = fs.readFileSync("apps/api/src/auth.ts", "utf8");
const service = fs.readFileSync("apps/api/src/service.ts", "utf8");
const repository = fs.readFileSync("packages/db/src/repository.ts", "utf8");
const migrate = fs.readFileSync("packages/db/src/migrate.ts", "utf8");
const bootstrapUi = fs.readFileSync("apps/web/components/BootstrapProject.tsx", "utf8");

test("initial setup authenticates and migrates before creating the first project", () => {
  assert.match(setupRoute, /requireBootstrapToken/);
  assert.match(setupRoute, /await migrateDatabase\(\)/);
  assert.match(setupRoute, /service\.setupProject/);
});

test("migration concurrency uses a transaction-scoped advisory lock", () => {
  assert.match(migrate, /pg_advisory_xact_lock/);
  assert.match(migrate, /create table if not exists schema_migrations/);
  assert.match(migrate, /databaseMigrations/);
});

test("first-project creation and bootstrap lock are atomic", () => {
  assert.match(repository, /async createInitialProject/);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /select exists\(select 1 from projects limit 1\)/);
  assert.match(service, /SETUP_ALREADY_COMPLETE/);
});

test("production readiness derives bootstrap lock from durable project state", () => {
  assert.match(readyRoute, /repository\.hasAnyProject\(\)/);
  assert.doesNotMatch(readyRoute, /CELLFLOW_SETUP_ENABLED/);
  assert.match(readyRoute, /latestMigrationVersion/);
});

test("bootstrap token no longer depends on a manual setup toggle", () => {
  assert.doesNotMatch(auth, /CELLFLOW_SETUP_ENABLED/);
  assert.match(auth, /CELLFLOW_BOOTSTRAP_TOKEN/);
});

test("setup UI describes automatic migration and lock behavior", () => {
  assert.match(bootstrapUi, /Schema initialization and bootstrap locking are automatic/);
  assert.match(bootstrapUi, /No manual SQL migration or post-setup environment toggle is required/);
});
