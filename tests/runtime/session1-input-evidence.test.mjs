import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) { return readFile(path, "utf8"); }

test("session 1 migration persists inputs and submission conflict evidence", async () => {
  const migration = await text("packages/db/migrations/005_input_evidence.sql");
  assert.match(migration, /input_out_points jsonb/);
  assert.match(migration, /submission_error_type/);
  assert.match(migration, /conflict_type/);
  assert.match(migration, /NODE_REJECTED/);
});

test("CCC prepare persists exact inputs before any broadcast call", async () => {
  const source = await text("packages/ccc/src/ccc.ts");
  const prepareAt = source.indexOf("await options.flow.prepare");
  const sendAt = source.indexOf("sendTransaction(signed)");
  assert.ok(prepareAt >= 0 && sendAt > prepareAt);
  assert.match(source, /extractInputOutPoints\(signed\)/);
  assert.match(source, /input\.previousOutput/);
  assert.match(source, /inputOutPoints,/);
});

test("broadcast classification separates ambiguity from explicit node rejection", async () => {
  const source = await text("packages/ccc/src/broadcast-errors.ts");
  assert.match(source, /outcome: "AMBIGUOUS" \| "NODE_REJECTED"/);
  assert.match(source, /errorType: "TRANSPORT_UNKNOWN"/);
  assert.match(source, /errorType: "RPC_REJECTION"/);
  assert.match(source, /INPUT_CONFLICT_SUSPECTED/);
  assert.match(source, /canonicalSpendConfirmed: false/);
});

test("API exposes durable input and rejection evidence", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const prepareRoute = await text("apps/web/app/api/v1/intents/[intentId]/prepare/route.ts");
  const rejectedRoute = await text("apps/web/app/api/v1/intents/[intentId]/rejected/route.ts");
  assert.match(repository, /input_out_points/);
  assert.match(repository, /submission_error_details/);
  assert.match(repository, /conflict_details/);
  assert.match(prepareRoute, /inputOutPoints/);
  assert.match(rejectedRoute, /NODE_REJECTED/);
});
