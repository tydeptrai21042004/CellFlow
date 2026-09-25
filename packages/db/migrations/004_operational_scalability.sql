-- CellFlow V0.4 operational scalability: durable project chain identity,
-- keyset pagination and worker-health indexes.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS rpc_genesis_hash text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_rpc_genesis_hash_format') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_rpc_genesis_hash_format
      CHECK (rpc_genesis_hash IS NULL OR rpc_genesis_hash ~ '^0x[0-9a-fA-F]{64}$');
  END IF;
END $$;


CREATE INDEX IF NOT EXISTS intents_project_created_id_idx
  ON intents(project_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS executions_active_observation_idx
  ON executions(project_id, last_observed_at)
  WHERE workflow_status NOT IN ('CONFIRMED','CONFLICTED','EXPIRED')
    AND chain_status <> 'REJECTED'
    AND tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_deliveries_project_due_idx
  ON webhook_deliveries(project_id, next_attempt_at, id)
  WHERE status IN ('PENDING','RETRY','CLAIMED');
