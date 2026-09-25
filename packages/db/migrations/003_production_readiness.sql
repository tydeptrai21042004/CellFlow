-- CellFlow V0.3 production readiness: scoped/expiring credentials,
-- project evidence exports, and indexes for operational-health queries.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['read','write','admin']::text[];
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scopes_nonempty') THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_nonempty CHECK (cardinality(scopes) >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scopes_valid') THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_valid CHECK (scopes <@ ARRAY['read','write','admin']::text[]);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS api_keys_active_expiry_idx
  ON api_keys(project_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS executions_project_reconcile_due_idx
  ON executions(project_id, next_reconcile_at)
  WHERE next_reconcile_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_deliveries_project_status_idx
  ON webhook_deliveries(project_id, status, next_attempt_at);

CREATE TABLE IF NOT EXISTS project_evidence_exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evidence_sha256 text NOT NULL,
  schema_version text NOT NULL DEFAULT 'cellflow-project-evidence-v1',
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_evidence_exports_project_idx
  ON project_evidence_exports(project_id, created_at DESC);
