import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const text = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("migration 006 preserves multiple transaction attempts per intent", async () => {
  const migration = await text("packages/db/migrations/006_transaction_attempts.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS transaction_attempts/i);
  assert.match(migration, /UNIQUE\(project_id, tx_hash\)/i);
  assert.match(migration, /UNIQUE\(intent_row_id, attempt_number\)/i);
  assert.match(migration, /active_attempt_id/i);
  assert.match(migration, /winning_attempt_id/i);
  assert.match(migration, /input_refs jsonb/i);
  assert.match(migration, /RBF_REPLACEMENT/);
  assert.match(migration, /REBUILD/);
});

test("repository uses current execution as projection instead of one-intent-one-hash invariant", async () => {
  const repository = await text("packages/db/src/repository.ts");
  assert.doesNotMatch(repository, /INTENT_TX_CONFLICT/);
  assert.match(repository, /TRANSACTION_ATTEMPT_CREATED/);
  assert.match(repository, /UNSAFE_ATTEMPT_REPLACEMENT/);
  assert.match(repository, /transaction_attempts/);
  assert.match(repository, /priorAttemptDisposition/);
});

test("CCC persists semantic input roles and attempt metadata", async () => {
  const ccc = await text("packages/ccc/src/ccc.ts");
  const client = await text("packages/ccc/src/client.ts");
  assert.match(ccc, /APPLICATION_STATE/);
  assert.match(ccc, /WALLET_FUNDING/);
  assert.match(ccc, /originalInputs/);
  assert.match(ccc, /applicationInputs/);
  assert.match(client, /attemptKind/);
  assert.match(client, /parentAttemptId/);
  assert.match(client, /inputRefs/);
});

test("reconciliation records role-aware conflict evidence", async () => {
  const rpc = await text("workflows/reconcile/src/rpc.ts");
  const reconcile = await text("workflows/reconcile/src/reconcile.ts");
  assert.match(rpc, /spentInputs/);
  assert.match(rpc, /contendedInputs/);
  assert.match(rpc, /unknownInputs/);
  assert.match(reconcile, /inputConflictDomain/);
  assert.match(reconcile, /inputDomain/);
  assert.match(reconcile, /spentInputs/);
  assert.match(reconcile, /contendedInputs/);
});

test("role-aware recommended actions distinguish wallet and application recovery", async () => {
  const stateMachine = await text("packages/core/src/state-machine.ts");
  assert.match(stateMachine, /RECOLLECT_WALLET_INPUTS/);
  assert.match(stateMachine, /REBUILD_AND_RESIGN/);
  assert.match(stateMachine, /REBUILD_FROM_LIVE_STATE/);
  assert.match(stateMachine, /inputDomain/);
});

test("generic negative JSON-RPC codes are not treated as deterministic rejection by code alone", async () => {
  const classifier = await text("packages/ccc/src/broadcast-errors.ts");
  assert.doesNotMatch(classifier, /record\.code === "number" && record\.code < 0/);
  assert.match(classifier, /negative JSON-RPC code alone is not sufficient/);
});

test("evidence export exposes attempt history", async () => {
  const evidence = await text("packages/core/src/evidence.ts");
  assert.match(evidence, /cellflow-evidence-v2/);
  assert.match(evidence, /activeAttemptId/);
  assert.match(evidence, /winningAttemptId/);
  assert.match(evidence, /attempts/);
});
