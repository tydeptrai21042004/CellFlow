-- CellFlow V0.2 hardening: concurrency leases, workflow dedupe, durable evidence,
-- rate limiting and database-level invariants. Safe to apply once via schema_migrations.

ALTER TABLE executions ADD COLUMN IF NOT EXISTS reconcile_lease_id text;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS reconcile_lease_until timestamptz;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS workflow_run_id text;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS workflow_started_at timestamptz;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS workflow_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS executions_reconcile_lease_idx
  ON executions(reconcile_lease_until) WHERE reconcile_lease_until IS NOT NULL;

ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_until timestamptz;
CREATE INDEX IF NOT EXISTS webhook_deliveries_lease_idx
  ON webhook_deliveries(lease_until) WHERE lease_until IS NOT NULL;

ALTER TABLE evidence_exports ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'cellflow-evidence-v1';
ALTER TABLE evidence_exports ADD COLUMN IF NOT EXISTS max_event_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE evidence_exports ADD COLUMN IF NOT EXISTS document jsonb;
CREATE INDEX IF NOT EXISTS evidence_exports_intent_idx
  ON evidence_exports(project_id, intent_row_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_exports_dedupe_idx
  ON evidence_exports(intent_row_id, evidence_sha256);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (project_id, bucket, window_start)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_submission_status_check') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_submission_status_check CHECK (
      submission_status IN ('NOT_SUBMITTED','PREPARED','BROADCASTING','SUBMISSION_UNKNOWN','SUBMITTED')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_chain_status_check') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_chain_status_check CHECK (
      chain_status IN ('UNOBSERVED','UNKNOWN','PENDING','PROPOSED','COMMITTED','REJECTED')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_workflow_status_check') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_workflow_status_check CHECK (
      workflow_status IN ('IDLE','RECONCILING','WAITING_CONFIRMATIONS','CONFIRMED','REORGED','CONFLICTED','EXPIRED')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_confirmation_nonnegative') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_confirmation_nonnegative CHECK (confirmation_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_attempts_nonnegative') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_attempts_nonnegative CHECK (reconcile_attempts >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executions_version_nonnegative') THEN
    ALTER TABLE executions ADD CONSTRAINT executions_version_nonnegative CHECK (version >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_delivery_status_check') THEN
    ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_delivery_status_check CHECK (
      status IN ('PENDING','CLAIMED','RETRY','DELIVERED','FAILED')
    );
  END IF;
END $$;
