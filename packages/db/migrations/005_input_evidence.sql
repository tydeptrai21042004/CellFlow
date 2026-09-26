-- Session 1: persist exact transaction inputs before broadcast and retain
-- submission-layer rejection evidence without claiming canonical input spend.

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS input_out_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submission_error_code text,
  ADD COLUMN IF NOT EXISTS submission_error_type text,
  ADD COLUMN IF NOT EXISTS submission_error_details jsonb,
  ADD COLUMN IF NOT EXISTS conflict_type text,
  ADD COLUMN IF NOT EXISTS conflict_details jsonb;

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_submission_status_check;
ALTER TABLE executions ADD CONSTRAINT executions_submission_status_check CHECK (
  submission_status IN (
    'NOT_SUBMITTED',
    'PREPARED',
    'BROADCASTING',
    'SUBMISSION_UNKNOWN',
    'SUBMITTED',
    'NODE_REJECTED'
  )
);

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_submission_error_type_check;
ALTER TABLE executions ADD CONSTRAINT executions_submission_error_type_check CHECK (
  submission_error_type IS NULL OR submission_error_type IN (
    'TRANSPORT_UNKNOWN',
    'RPC_REJECTION',
    'HASH_MISMATCH'
  )
);

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_conflict_type_check;
ALTER TABLE executions ADD CONSTRAINT executions_conflict_type_check CHECK (
  conflict_type IS NULL OR conflict_type IN (
    'INPUT_CONFLICT_SUSPECTED',
    'INPUT_SPENT',
    'EXPECTED_CELL_ASSERTION_FAILED',
    'REORG_CONFLICT',
    'OTHER'
  )
);

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_input_out_points_array_check;
ALTER TABLE executions ADD CONSTRAINT executions_input_out_points_array_check CHECK (
  jsonb_typeof(input_out_points) = 'array'
);

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_node_rejected_evidence_check;
ALTER TABLE executions ADD CONSTRAINT executions_node_rejected_evidence_check CHECK (
  submission_status <> 'NODE_REJECTED' OR submission_error_type = 'RPC_REJECTION'
);
