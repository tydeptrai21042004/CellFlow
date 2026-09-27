# CellFlow Testnet Evidence Bundle

This directory is for reviewer-verifiable funding evidence. Generated local artifacts go to `generated/` and are gitignored by default so deployment URLs/IDs can be reviewed before publication.

## Automated evidence available in this change set

1. `npm run evidence:testnet-preflight`
   - verifies the configured CKB endpoints answer as the expected network;
   - records genesis hashes and tip observations;
   - requires at least two configured endpoints for a funding-grade pass.

2. `npm run evidence:rpc-failover`
   - validates each configured endpoint identity;
   - injects a deliberately unusable first endpoint;
   - exercises CellFlow's real `CkbRpcClient` fallback path;
   - labels the result as **injected failure**, not as a real provider outage.

3. `npm run evidence:db-restart`
   - creates an intent in one Node.js process;
   - exits that process;
   - starts another process and loads the exact same PostgreSQL operation identity;
   - proves DB durability across a process boundary.

## Evidence that still needs real external execution

Automation cannot honestly manufacture these claims:

- a real signed/broadcast Testnet transaction with an intentionally unusable submit response;
- an actual deployment/redeploy interruption during reconciliation;
- a genuine outage of an independent RPC provider;
- an independent application/maintainer adoption;
- several weeks of operational history;
- an external security review.

When publishing evidence, copy only reviewed JSON into a curated dated directory and retain the source commit SHA, transaction hash/outpoint, timestamps, and exact command used.
