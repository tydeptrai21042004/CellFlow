-- Candidate-aware transaction evidence.
--
-- CKB RBF may legitimately leave more than one transaction attempt unresolved
-- until chain evidence chooses the winner. Keep the legacy executions row as a
-- convenient current-attempt projection, but preserve per-attempt signed-payload
-- revisions and per-RPC observations independently.

CREATE TABLE IF NOT EXISTS signed_payload_revisions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_row_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES transaction_attempts(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  payload_hash_sha256 text NOT NULL CHECK (payload_hash_sha256 ~ '^0x[0-9a-f]{64}$'),
  revision_kind text NOT NULL DEFAULT 'INITIAL'
    CHECK (revision_kind IN ('INITIAL','COSIGNATURE','MANUAL_REPLACEMENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, revision_number),
  UNIQUE(attempt_id, payload_hash_sha256)
);

CREATE INDEX IF NOT EXISTS signed_payload_revisions_intent_idx
  ON signed_payload_revisions(intent_row_id, attempt_id, revision_number);

-- Preserve the fingerprint already stored by migration 007 as revision #1.
INSERT INTO signed_payload_revisions (
  id, project_id, intent_row_id, attempt_id, revision_number,
  payload_hash_sha256, revision_kind, created_at
)
SELECT
  gen_random_uuid()::text,
  a.project_id,
  a.intent_row_id,
  a.id,
  1,
  a.signed_payload_hash_sha256,
  'INITIAL',
  a.created_at
FROM transaction_attempts a
WHERE a.signed_payload_hash_sha256 IS NOT NULL
ON CONFLICT (attempt_id, payload_hash_sha256) DO NOTHING;

CREATE TABLE IF NOT EXISTS rpc_observations (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_row_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  attempt_id text REFERENCES transaction_attempts(id) ON DELETE CASCADE,
  tx_hash text NOT NULL,
  rpc_endpoint text,
  observed_status text NOT NULL,
  block_hash text,
  block_number text,
  tip_block_number text,
  canonical_block_hash text,
  input_state text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  raw_observation jsonb,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rpc_observations_attempt_time_idx
  ON rpc_observations(attempt_id, observed_at DESC)
  WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rpc_observations_intent_time_idx
  ON rpc_observations(intent_row_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS rpc_observations_tx_time_idx
  ON rpc_observations(project_id, tx_hash, observed_at DESC);
