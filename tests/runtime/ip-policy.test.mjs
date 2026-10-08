import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";

// Execute only the exported, dependency-free IP classification function plus its
// private helpers. Avoid needing Postgres/Zod when testing this security boundary.
function loadIpClassifier(path, symbol, endMarker) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("function ipv4ToInt");
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end).replace(`export function ${symbol}`, `function ${symbol}`);
  return runInNewContext(`${stripTypeScriptTypes(body)}\n${symbol};`, { isIP, URL });
}

for (const [name, file, symbol, end] of [
  ["webhooks", "packages/webhooks/src/ssrf.ts", "isBlockedIp", "export interface ValidatedWebhookDestination"],
  ["CKB RPC", "workflows/reconcile/src/rpc.ts", "isBlockedRpcIp", "interface ResolvedRpcDestination"],
]) {
  test(`${name}: rejects private, metadata, IPv4-mapped and translated IPv6`, () => {
    const blocked = loadIpClassifier(file, symbol, end);
    for (const address of [
      "127.0.0.1", "10.2.3.4", "169.254.169.254", "192.168.1.1", "::1", "fe80::1", "fc00::1",
      "::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "::ffff:0:10.0.0.1",
      "::7f00:1", "2001:0db8::1", "2001:0:0:1::1", "64:ff9b:1::a00:1", "3fff::1",
    ]) {
      assert.equal(blocked(address), true, `${address} unexpectedly permitted`);
    }
  });
  test(`${name}: keeps public endpoints reachable`, () => {
    const blocked = loadIpClassifier(file, symbol, end);
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
      assert.equal(blocked(address), false, `${address} unexpectedly blocked`);
    }
  });
}
