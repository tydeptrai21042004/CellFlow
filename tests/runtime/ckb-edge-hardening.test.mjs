import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("packages/db/migrations/007_signed_payload_fingerprint.sql", "utf8");
const repository = fs.readFileSync("packages/db/src/repository.ts", "utf8");
const ccc = fs.readFileSync("packages/ccc/src/ccc.ts", "utf8");
const reconcile = fs.readFileSync("workflows/reconcile/src/reconcile.ts", "utf8");
const rpc = fs.readFileSync("workflows/reconcile/src/rpc.ts", "utf8");
const classifier = fs.readFileSync("packages/ccc/src/broadcast-errors.ts", "utf8");

test("signed payload fingerprint is durable evidence for each transaction attempt", () => {
  assert.match(migration, /signed_payload_hash_sha256/);
  assert.match(repository, /signedPayloadHashSha256/);
  assert.match(ccc, /signedPayloadFingerprintSha256\(signed\)/);
  assert.match(reconcile, /SIGNED_PAYLOAD_MISMATCH/);
});

test("attempt lineage exposes explicit replacement relationships", () => {
  assert.match(repository, /replacesAttemptId: attempt\.attemptKind === "RBF_REPLACEMENT"/);
  assert.match(repository, /replacedByAttemptId:/);
});

test("live Cell evidence verifies source block canonicality when supported", () => {
  assert.match(rpc, /verifyCanonicalBlockAt/);
  assert.match(reconcile, /live\.blockHashCanonical/);
  assert.match(reconcile, /canonicalAtObservation/);
});

test("CKB maturity and since errors stay retryable without automatic rebuild semantics", () => {
  assert.match(classifier, /CKB_MATURITY_OR_SINCE/);
  assert.match(classifier, /requiresResign: false/);
});

test("RPC observations retain endpoint provenance", () => {
  assert.match(rpc, /rpcEndpoint: session\.url/);
});
