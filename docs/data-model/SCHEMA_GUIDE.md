# Schema Guide

Recommended tables:

- `projects`
- `api_keys`
- `intents`
- `executions`
- `state_events`
- `webhook_endpoints`
- `webhook_deliveries`
- `evidence_exports`

Critical constraints:

```text
UNIQUE(project_id, intent_id)
UNIQUE(project_id, tx_hash) where desired by policy
FOREIGN KEY all tenant-owned records -> project_id
```

The state event table should be append-only in ordinary application paths. The current normalized status on `executions` is a projection/cache for efficient reads; the event history explains how that state was reached.

Never hold a DB transaction open while waiting on CKB RPC or webhook HTTP responses.
