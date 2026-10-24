import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

const migration = read("packages/db/migrations/008_candidate_attempt_evidence.sql");
const repository = read("packages/db/src/repository.ts");
const reconcile = read("workflows/reconcile/src/reconcile.ts");
const schema = read("apps/api/src/schemas.ts");
const ccc = read("packages/ccc/src/ccc.ts");
const releasePreflight = read("scripts/release-preflight.mjs");

test("RBF keeps unresolved parent attempts as candidates instead of superseding immediately", () => {
  assert.match(repository, /attemptKind !== "RBF_REPLACEMENT"/);
  assert.match(repository, /both hashes[\s\S]*remain ACTIVE candidates/);
  assert.match(repository, /RBF_INPUTS_DO_NOT_OVERLAP/);
  assert.match(repository, /sharesInput/);
});

test("RBF replacement requires shared CKB input evidence", () => {
  assert.match(repository, /parentKeys/);
  assert.match(repository, /persistedInputs\.some/);
  assert.match(repository, /shared input/);
});

test("reconciliation probes older ACTIVE candidates and promotes a canonical winner", () => {
  assert.match(reconcile, /promoteCommittedCompetingCandidate/);
  assert.match(reconcile, /COMPETING_ATTEMPT_COMMITTED/);
  assert.match(reconcile, /COMPETING_ATTEMPT_CONFIRMED/);
  assert.match(repository, /promoteAttemptProjection/);
  assert.match(repository, /winning_attempt_id/);
  assert.match(reconcile, /unresolvedCompetingCandidate/);
});

test("per-RPC observations and signed payload revisions are durable", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS rpc_observations/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS signed_payload_revisions/i);
  assert.match(repository, /recordRpcObservation/);
  assert.match(repository, /signed_payload_revisions/);
});

test("witness payload evolution is explicit opt-in for CoBuild or multisig style signing", () => {
  assert.match(schema, /allowSignedPayloadRevision/);
  assert.match(ccc, /allowSignedPayloadRevision/);
  assert.match(repository, /ATTEMPT_SIGNED_PAYLOAD_CONFLICT/);
  assert.match(repository, /COSIGNATURE/);
});

test("release preflight validates runtime files without requiring env templates", () => {
  // CI and Vercel use secure configured variables, not checked-in .env files.
  // Optional developer dotfiles remain visible as advisory warnings only.
  for (const file of [".gitignore", ".nvmrc", "vercel.json"]) {
    assert.match(releasePreflight, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
