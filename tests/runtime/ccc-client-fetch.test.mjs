import test from "node:test";
import assert from "node:assert/strict";
import { CellFlowClient, CellFlowHttpError } from "../../packages/ccc/src/client.ts";

const client = (options = {}) => new CellFlowClient({
  endpoint: "https://cellflow.example.com///",
  apiKey: "expected-secret",
  ...options,
});
const payload = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("request supports Headers objects and cannot override configured authorization", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://cellflow.example.com/api/v1/intents/id%20with%20space");
    assert.equal(init.headers.get("authorization"), "Bearer expected-secret");
    assert.equal(init.headers.get("content-type"), "application/json");
    assert.equal(init.headers.get("x-custom"), "yes");
    assert.ok(init.signal instanceof AbortSignal);
    return payload({ intent: { intentId: "ok" } });
  };
  const value = await client().get("id with space", { headers: new Headers({ "x-custom": "yes", authorization: "Bearer wrong" }) });
  assert.equal(value.intentId, "ok");
});

test("request supports header-pair arrays and native header maps", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const headers of [[ ["x-custom", "pairs"] ], { "x-custom": "map" }]) {
    globalThis.fetch = async (_url, init) => {
      assert.ok(["pairs", "map"].includes(init.headers.get("x-custom")));
      return payload({ intent: { status: "CONFIRMED" } });
    };
    assert.equal((await client().get("x", { headers })).status, "CONFIRMED");
  }
});

test("HTTP responses are never retried and 404 maps to a missing intent", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return payload({ error: { code: "NOT_FOUND", message: "Not found" } }, 404); };
  assert.equal(await client({ transportRetryAttempts: 5 }).get("missing"), null);
  assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; return payload({ error: { code: "DENIED", message: "Denied" } }, 403); };
  await assert.rejects(client({ transportRetryAttempts: 5 }).get("x"), (error) =>
    error instanceof CellFlowHttpError && error.status === 403 && error.code === "DENIED");
  assert.equal(calls, 2);
});

test("malformed successful JSON never replays a request", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("<html>bad gateway</html>", { status: 200 }); };
  await assert.rejects(client({ transportRetryAttempts: 4 }).get("x"), (error) =>
    error instanceof CellFlowHttpError && error.code === "INVALID_RESPONSE");
  assert.equal(calls, 1);
});

test("non-JSON errors do not trigger a replay or an uncaught property access", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("not JSON", { status: 503 }); };
  await assert.rejects(client({ transportRetryAttempts: 4 }).get("x"), (error) =>
    error instanceof CellFlowHttpError && error.status === 503 && error.code === "HTTP_ERROR");
  assert.equal(calls, 1);
});

test("real transport errors can retry under the explicit retry setting", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new TypeError("socket failed");
    return payload({ intent: { status: "CONFIRMED" } });
  };
  assert.equal((await client({ transportRetryAttempts: 2, transportRetryDelayMs: 0 }).get("x")).status, "CONFIRMED");
  assert.equal(calls, 2);
});

test("caller cancellation is never retried", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => {
    calls++;
    controller.abort(new DOMException("cancelled", "AbortError"));
    throw init.signal.reason;
  };
  await assert.rejects(client({ transportRetryAttempts: 5 }).get("x", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("caller cancellation interrupts the retry delay", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  const controller = new AbortController();
  globalThis.fetch = async () => { calls++; throw new Error("offline"); };
  const operation = client({ transportRetryAttempts: 4, transportRetryDelayMs: 5_000 }).get("x", { signal: controller.signal });
  setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 15);
  await assert.rejects(operation, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("timeout applies even when caller supplies a signal", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  };
  // AbortSignal.timeout uses an unref'ed timer in Node; keep the test event loop
  // alive when the mocked fetch has no socket of its own.
  const keepAlive = setTimeout(() => {}, 150);
  try {
    await assert.rejects(client({ requestTimeoutMs: 15, transportRetryAttempts: 3 }).get("x", { signal: controller.signal }),
      (error) => error?.name === "TimeoutError");
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(calls, 1);
  assert.equal(controller.signal.aborted, false);
});

test("invalid retry count is bounded and does not loop forever", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("offline"); };
  await assert.rejects(client({ transportRetryAttempts: Number.POSITIVE_INFINITY, transportRetryDelayMs: Number.NaN }).get("x"), /offline/);
  assert.equal(calls, 1);
});
