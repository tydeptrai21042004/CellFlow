# Reconciliation workflow

`@cellflow/reconcile` performs one deterministic reconciliation step. It queries standard CKB RPC methods (`get_transaction`, `get_header`, `get_tip_header`), maps the observation into the canonical state machine, calculates confirmation depth, detects explicit reorg evidence, verifies optional expected output Cells after confirmation, persists the snapshot with optimistic concurrency and queues state-change webhooks.

`apps/web/workflows/reconcile-intent.ts` wraps these steps in Vercel Workflow (`"use workflow"` / `"use step"`) so polling survives function termination and redeploy. The maintenance cron is a repair sweep for due executions, not the only progress mechanism.
