import test from "node:test";
import assert from "node:assert/strict";
import { jsonRequest } from "../../apps/web/lib/browser-api.ts";

test("browser API preserves HeadersInit forms and enforces configured Bearer key", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const incoming of [new Headers({ "x-extra": "yes" }), [["x-extra", "yes"]], { "x-extra": "yes" }]) {
    globalThis.fetch = async (_path, init) => {
      assert.equal(init.headers.get("x-extra"), "yes");
      assert.equal(init.headers.get("authorization"), "Bearer expected");
      assert.match(init.headers.get("x-request-id"), /.+/);
      assert.equal(init.headers.get("content-type"), "application/json");
      return Response.json({ success: true });
    };
    assert.equal((await jsonRequest("/api/health", "expected", { headers: incoming })).success, true);
  }
});

test("browser API returns a traceable error for invalid and empty responses", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("Service Unavailable", { status: 503 });
  await assert.rejects(jsonRequest("/api/ready"), /HTTP 503 \[request /);
});

test("browser API refuses external URLs when credentials are configured", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new Error("fetch must not be called"); };
  await assert.rejects(jsonRequest("https://other-site.example/secret", "expected"), /same-origin/);
  await assert.rejects(jsonRequest("//evil.example/api/keys", "expected"), /same-origin/);
});

test("browser API rejects an invalid successful JSON response", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("<h1>Bad gateway</h1>", { status: 200 });
  await assert.rejects(jsonRequest("/api/v1/intents"), /invalid JSON \[request /);
});
