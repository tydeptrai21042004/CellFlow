import { access, readFile } from "node:fs/promises";

const required = [
  "packages/core/src/index.ts",
  "packages/db/migrations/001_init.sql",
  "packages/ccc/src/ccc.ts",
  "packages/assertions/src/index.ts",
  "packages/webhooks/src/index.ts",
  "workflows/reconcile/src/index.ts",
  "apps/api/src/index.ts",
  "apps/web/app/page.tsx",
  "apps/web/workflows/reconcile-intent.ts",
  "vercel.json",
];
for (const path of required) await access(path);
const migration = await readFile("packages/db/migrations/001_init.sql", "utf8");
for (const table of ["projects", "api_keys", "intents", "executions", "state_events", "webhook_endpoints", "webhook_deliveries"]) {
  if (!migration.includes(`TABLE IF NOT EXISTS ${table}`)) throw new Error(`Migration is missing ${table}`);
}
console.log(`CellFlow implementation tree verified (${required.length} critical files).`);
