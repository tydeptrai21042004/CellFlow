# Mandatory Failure Scenarios

## F01 — Duplicate intent
Send the same `(project, intentId)` concurrently 10 times. Expected: one logical intent, deterministic response, no duplicate business execution record.

## F02 — RPC outage
Make CKB RPC unavailable during reconciliation. Expected: `UNKNOWN`/`RECONCILING`, durable retry, eventual recovery after endpoint returns.

## F03 — Process restart
Terminate the API/workflow runtime after a state write and before the next check. Expected: workflow resumes from DB state with no manual repair.

## F04 — Ambiguous submit
Simulate timeout after a transaction may have reached RPC. Expected: query by deterministic tx hash before deciding to rebroadcast.

## F05 — Rejected transaction
Return authoritative rejection. Expected: terminal `REJECTED`, webhook emitted once logically (delivery may be retried), evidence includes reason/raw observation.

## F06 — Webhook receiver down
Return 5xx/timeouts. Expected: retry with durable delivery records; transaction state is unaffected.

## F07 — Malicious webhook URL
Attempt loopback/private metadata destination. Expected: rejected configuration.
