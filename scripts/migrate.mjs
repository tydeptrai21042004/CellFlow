import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
const directory = path.resolve("packages/db/migrations");
const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

try {
  await sql`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const appliedRows = await sql`select version from schema_migrations`;
  const applied = new Set(appliedRows.map((row) => String(row.version)));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip ${file}`);
      continue;
    }
    const source = await fs.readFile(path.join(directory, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(source);
      await tx`insert into schema_migrations (version) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
