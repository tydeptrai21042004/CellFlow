import type { Sql } from "postgres";
import { getSql } from "./client.ts";
import { databaseMigrations, latestMigrationVersion } from "./migrations.generated.ts";

// Stable application-specific advisory lock keys. The transaction-scoped lock
// serializes first-use migration attempts across concurrent Vercel invocations.
const MIGRATION_LOCK_A = 1128678999;
const MIGRATION_LOCK_B = 1296648018;

export type MigrationResult = {
  latest: string | null;
  applied: string[];
  skipped: string[];
};

export async function migrateDatabase(sql: Sql = getSql()): Promise<MigrationResult> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_A}, ${MIGRATION_LOCK_B})`;
    await tx`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const rows = await tx`select version from schema_migrations`;
    const existing = new Set(rows.map((row) => String(row.version)));
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of databaseMigrations) {
      if (existing.has(migration.version)) {
        skipped.push(migration.version);
        continue;
      }
      await tx.unsafe(migration.source);
      await tx`insert into schema_migrations (version) values (${migration.version})`;
      applied.push(migration.version);
    }

    return { latest: latestMigrationVersion, applied, skipped };
  });
}

export { latestMigrationVersion };
