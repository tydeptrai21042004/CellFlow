import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("production dashboard exposes health, metrics, search, filters and auto refresh", async () => {
  const source = await read("apps/web/components/Dashboard.tsx");
  for (const token of ["/api/health", "/api/health/rpc", "metric-grid", "Search intent", "Auto-refresh 15s", "ATTENTION"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("dashboard keeps service API keys in memory only", async () => {
  const source = await read("apps/web/components/Dashboard.tsx");
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="off"/);
});

test("intent detail is operationally inspectable without creating an evidence export", async () => {
  const route = await read("apps/web/app/api/v1/intents/[intentId]/route.ts");
  const service = await read("apps/api/src/service.ts");
  assert.match(route, /service\.intentDetail/);
  assert.doesNotMatch(route, /service\.evidence/);
  assert.match(service, /expectedCells/);
  assert.match(service, /getEvents/);
});

test("intent drawer includes lifecycle, confirmation, assertion and audit timeline surfaces", async () => {
  const source = await read("apps/web/components/IntentDrawer.tsx");
  for (const token of ["Lifecycle", "confirmations", "Assertion", "Expected Cells", "Audit timeline", "role=\"dialog\""]) assert.match(source, new RegExp(token, "i"));
});

test("example walkthrough is explicitly local-only and demonstrates ambiguous submission recovery", async () => {
  const source = await read("apps/web/components/ExampleUse.tsx");
  assert.match(source, /local only/i);
  assert.match(source, /SUBMISSION_UNKNOWN/);
  assert.match(source, /reconcile by hash/i);
  assert.match(source, /SkillPass Service Bundle/);
  assert.match(source, /Alice → Bob/);
});

test("integrations UI manages API keys and signed webhooks", async () => {
  const source = await read("apps/web/components/IntegrationsPanel.tsx");
  assert.match(source, /\/api\/v1\/api-keys/);
  assert.match(source, /\/api\/v1\/webhooks/);
  assert.match(source, /Send test/);
  assert.match(source, /Signing secret/);
});

test("UI contains accessibility and reduced-motion affordances", async () => {
  const dashboard = await read("apps/web/components/Dashboard.tsx");
  const css = await read("apps/web/app/globals.css");
  assert.match(dashboard, /aria-live="polite"/);
  assert.match(dashboard, /aria-label="Project summary"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.sr-only/);
});

test("Vercel config lets Next.js own .next output and stays Hobby-cron compatible", async () => {
  const config = JSON.parse(await read("vercel.json"));
  assert.equal("outputDirectory" in config, false);
  assert.equal(config.crons?.[0]?.schedule, "0 0 * * *");
});
