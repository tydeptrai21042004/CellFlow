# CellFlow Production Operations Runbook

## Readiness contract

`GET /api/ready` is the deployment readiness gate. It also verifies that the latest required database migration (`004_operational_scalability.sql`) is applied. Production should not receive traffic unless it returns HTTP 200. In production, unauthenticated callers receive only the minimal readiness result; send an **admin-scoped** project API key when operators need detailed checks/warnings.

A production deployment should additionally have no unresolved readiness warnings. In particular:

- configure at least two independent CKB RPC endpoints;
- set `CKB_EXPECTED_GENESIS_HASH` for the selected network;
- use HTTPS RPC endpoints (`CKB_ALLOW_INSECURE_RPC=false`) unless an explicitly reviewed exception is required;
- set `CELLFLOW_SETUP_ENABLED=false` after bootstrap;
- keep `CELLFLOW_ENCRYPTION_KEY` and `CRON_SECRET` independent and high entropy.

## Dashboard signals

The **Production health** panel exposes:

- reconciliation backlog;
- currently leased reconciliation jobs (leases are renewed per item before RPC work);
- stale active intents that have not received a fresh chain observation;
- failed/pending webhook deliveries;
- active API keys and keys expiring within seven days.

Suggested first-response thresholds:

| Signal | Investigate when |
| --- | --- |
| Reconciliation backlog | grows across two maintenance runs or exceeds worker batch capacity |
| Stale active intents | any persistent non-zero value |
| Failed webhooks | non-zero after endpoint owner confirms availability |
| Expiring API keys | within seven days for a production integration |
| Readiness | any HTTP 503 |

## RPC incident

1. Confirm `/api/ready` and `/api/health/rpc`.
2. Check whether the primary RPC is in circuit-breaker cooldown.
3. Verify the fallback provider is independent from the primary provider.
4. Compare `get_blockchain_info.chain` and genesis hash with the configured project/network.
5. Confirm the project-persisted genesis identity still matches the selected endpoint after any RPC/provider change.
6. Do **not** rebroadcast a transaction only because an RPC call timed out. Reconcile by the persisted deterministic transaction hash first.

## Webhook incident

1. Open **Keys & webhooks** and inspect failed/pending counters.
2. Validate the receiver verifies timestamp + HMAC and deduplicates event IDs.
3. Fix the endpoint.
4. Check receiver `Retry-After` behavior for 429/5xx responses; CellFlow honors it within a bounded delay.
5. Use **Retry failed** to requeue dead-lettered deliveries.
6. If the endpoint is compromised, disable it and add it again to rotate the signing secret.

## Credential incident

1. Create a replacement key with the minimum required scopes.
2. Update the integration.
3. Verify successful requests with the replacement key.
4. Revoke the old key.
5. If an admin key was exposed, also rotate webhook secrets for endpoints managed with that credential and review recent operator changes.

## Evidence for incident review

- Per-intent evidence: `/api/v1/intents/{intentId}/evidence`.
- Read-only project evidence: `GET /api/v1/project-evidence` (no durable write).
- Recorded project evidence: `POST /api/v1/project-evidence` with an admin-scoped key.
- Error responses include `x-request-id` and a matching structured log record.

Do not treat a SHA-256 export fingerprint as a third-party signature. It is an integrity fingerprint for the exported document.


## Large project / backlog handling

- Intent history uses keyset pagination. Use the returned `nextCursor` rather than synthesizing or editing cursors.
- Reconciliation and webhook workers use bounded concurrency and renewable leases. Tune `CELLFLOW_RECONCILE_CONCURRENCY` and `CELLFLOW_WEBHOOK_CONCURRENCY` conservatively against RPC/database limits.
- The daily maintenance endpoint is intentionally bounded by `CELLFLOW_MAINTENANCE_RECONCILE_LIMIT` and `CELLFLOW_MAINTENANCE_WEBHOOK_LIMIT`; it is a repair sweep, not the primary scheduler.
- If backlog grows, scale the durable workflow path first instead of raising maintenance limits until serverless timeouts become likely.
