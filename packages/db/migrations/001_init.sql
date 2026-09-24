CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet', 'devnet')),
  rpc_url text,
  confirmation_policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'default',
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id);

CREATE TABLE IF NOT EXISTS intents (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, intent_id)
);

CREATE TABLE IF NOT EXISTS executions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_row_id text NOT NULL UNIQUE REFERENCES intents(id) ON DELETE CASCADE,
  tx_hash text,
  network text NOT NULL,
  submission_status text NOT NULL,
  chain_status text NOT NULL,
  workflow_status text NOT NULL,
  confirmation_policy jsonb NOT NULL,
  confirmation_count integer NOT NULL DEFAULT 0,
  committed_block_hash text,
  committed_block_number text,
  rejection_reason text,
  assertion_status text,
  assertion_result jsonb,
  last_raw_observation jsonb,
  last_observed_at timestamptz,
  next_reconcile_at timestamptz,
  reconcile_attempts integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS executions_project_tx_hash_unique
  ON executions(project_id, tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS executions_due_idx
  ON executions(next_reconcile_at) WHERE next_reconcile_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS state_events (
  sequence bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_row_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  execution_id text NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  raw_observation jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS state_events_intent_idx ON state_events(project_id, intent_row_id, sequence);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  signing_secret_encrypted text NOT NULL,
  secret_version integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, url)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  endpoint_id text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  response_status integer,
  last_error text,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries(next_attempt_at, status);

CREATE TABLE IF NOT EXISTS evidence_exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_row_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  evidence_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
