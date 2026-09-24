# `@cellflow/db`

PostgreSQL is CellFlow's durable application source of truth. `migrations/001_init.sql` creates project/API-key records, idempotent intents, versioned executions, append-only state events, per-endpoint webhook secrets/deliveries and evidence-export metadata.

Important invariants include:

- `UNIQUE(project_id, intent_id)` for business idempotency;
- a project cannot bind the same transaction hash to unrelated executions;
- execution updates use an optimistic `version` field;
- chain observation, submission state and workflow state are stored separately;
- committed block hash/height and confirmation count remain available for reorg detection;
- reconciliation timestamps/attempts survive serverless restarts.

Run `npm run migrate` from the repository root after configuring `DATABASE_URL`.
