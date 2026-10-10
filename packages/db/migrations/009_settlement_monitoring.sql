-- The first settlement-ready decision is the durable origin for the optional
-- finite post-confirmation monitoring horizon. Reset on explicit invalidation.
ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS settlement_ready_at timestamptz;
