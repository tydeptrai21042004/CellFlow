import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

const required = [
  "package.json",
  ".env.example",
  "vercel.json",
  "packages/core/src/state-machine.ts",
  "packages/db/migrations/001_init.sql",
  "packages/ccc/src/ccc.ts",
  "packages/assertions/src/index.ts",
  "packages/webhooks/src/ssrf.ts",
  "workflows/reconcile/src/reconcile.ts",
  "apps/web/workflows/reconcile-intent.ts",
  "apps/web/app/api/v1/intents/route.ts",
  "apps/web/app/page.tsx",
];

test("runnable implementation files are present", async () => {
  for (const file of required) {
    await assert.doesNotReject(access(file), file);
  }
});
