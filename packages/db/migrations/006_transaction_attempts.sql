-- CrowdCell recovery model: one durable business intent may own several signed
-- transaction attempts. Keep executions as the current-attempt projection while
-- transaction_attempts preserves immutable tx identities and attempt history.

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS input_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_input_refs_array_check;
ALTER TABLE executions ADD CONSTRAINT executions_input_refs_array_check CHECK (
  jsonb_typeof(input_refs) = 'array'
);

-- Backfill semantic-neutral input references for operations prepared before this migration.
UPDATE executions
SET input_refs = COALESCE((
  SELECT jsonb_agg(
    jsonb_build_object(
      'outPoint', item.value,
      'role', 'OTHER'
    )
    ORDER BY item.ordinality
  )
  FROM jsonb_array_elements(input_out_points) WITH ORDINALITY AS item(value, ordinality)
), '[]'::jsonb)
WHERE jsonb_array_length(input_refs) = 0
  AND jsonb_array_length(input_out_points) > 0;

CREATE TABLE IF NOT EXISTS transaction_attempts (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  intent_row_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  tx_hash text NOT NULL,
  parent_attempt_id text REFERENCES transaction_attempts(id) ON DELETE SET NULL,
  attempt_kind text NOT NULL CHECK (attempt_kind IN ('INITIAL','REBUILD','RBF_REPLACEMENT','MANUAL_RETRY')),
  disposition text NOT NULL DEFAULT 'ACTIVE' CHECK (disposition IN ('ACTIVE','SUPERSEDED','CONFIRMED','REJECTED','CONFLICTED','ABANDONED')),
  input_out_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  submission_status text NOT NULL,
  chain_status text NOT NULL,
  workflow_status text NOT NULL,
  submission_error_code text,
  submission_error_type text,
  submission_error_details jsonb,
  conflict_type text,
  conflict_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, tx_hash),
  UNIQUE(intent_row_id, attempt_number),
  CHECK (jsonb_typeof(input_out_points) = 'array'),
  CHECK (jsonb_typeof(input_refs) = 'array')
);

CREATE INDEX IF NOT EXISTS transaction_attempts_intent_idx
  ON transaction_attempts(intent_row_id, attempt_number);
CREATE INDEX IF NOT EXISTS transaction_attempts_active_idx
  ON transaction_attempts(project_id, disposition, updated_at DESC)
  WHERE disposition = 'ACTIVE';

ALTER TABLE intents
  ADD COLUMN IF NOT EXISTS active_attempt_id text,
  ADD COLUMN IF NOT EXISTS winning_attempt_id text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intents_active_attempt_fk') THEN
    ALTER TABLE intents ADD CONSTRAINT intents_active_attempt_fk
      FOREIGN KEY (active_attempt_id) REFERENCES transaction_attempts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intents_winning_attempt_fk') THEN
    ALTER TABLE intents ADD CONSTRAINT intents_winning_attempt_fk
      FOREIGN KEY (winning_attempt_id) REFERENCES transaction_attempts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Preserve existing tracked transactions as attempt #1.
INSERT INTO transaction_attempts (
  id, project_id, intent_row_id, attempt_number, tx_hash,
  parent_attempt_id, attempt_kind, disposition,
  input_out_points, input_refs,
  submission_status, chain_status, workflow_status,
  submission_error_code, submission_error_type, submission_error_details,
  conflict_type, conflict_details, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  e.project_id,
  e.intent_row_id,
  1,
  e.tx_hash,
  NULL,
  'INITIAL',
  CASE
    WHEN e.workflow_status = 'CONFIRMED' THEN 'CONFIRMED'
    WHEN e.workflow_status = 'CONFLICTED' THEN 'CONFLICTED'
    WHEN e.chain_status = 'REJECTED' OR e.submission_status = 'NODE_REJECTED' THEN 'REJECTED'
    ELSE 'ACTIVE'
  END,
  e.input_out_points,
  e.input_refs,
  e.submission_status,
  e.chain_status,
  e.workflow_status,
  e.submission_error_code,
  e.submission_error_type,
  e.submission_error_details,
  e.conflict_type,
  e.conflict_details,
  e.created_at,
  e.updated_at
FROM executions e
WHERE e.tx_hash IS NOT NULL
ON CONFLICT (project_id, tx_hash) DO NOTHING;

UPDATE intents i
SET active_attempt_id = a.id
FROM transaction_attempts a
WHERE a.intent_row_id = i.id
  AND a.attempt_number = (
    SELECT max(latest.attempt_number)
    FROM transaction_attempts latest
    WHERE latest.intent_row_id = i.id
  )
  AND i.active_attempt_id IS NULL;

UPDATE intents i
SET winning_attempt_id = a.id
FROM transaction_attempts a
WHERE a.intent_row_id = i.id
  AND a.disposition = 'CONFIRMED'
  AND i.winning_attempt_id IS NULL;
