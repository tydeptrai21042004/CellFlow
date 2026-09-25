# CellFlow security hardening — 2026-09-25

This pass strengthens failure semantics and security invariants without changing CellFlow's product scope.

## High-impact changes

- **Preserve committed evidence during RPC outages.** Reconciliation now routes RPC failure through the core state machine. A temporary outage can move workflow handling back to reconciliation, but cannot erase a prior `COMMITTED` chain observation unless canonicality is explicitly disproved.
- **Serialize API-key lifecycle mutations.** API-key creation and revocation take a project-row lock so concurrent revocations cannot each observe the other key and remove both.
- **Protect the last administrator.** Revoking the last active admin-scoped key is rejected even when another read/write-only key remains.
- **Verify the exact RPC selected by failover.** Before trusting transaction observations, the selected endpoint is checked against the project's expected CKB chain and optional pinned genesis hash.
- **Validate all configured RPC endpoints in readiness.** Primary and fallbacks are checked independently for network, genesis, reachability, and initial block download state.
- **Make evidence reads side-effect free.** `GET /api/v1/intents/{intentId}/evidence` only computes evidence. Durable export recording is now an explicit admin-only `POST`.
- **Stronger HTTP headers.** Added HSTS and disabled DNS prefetching in addition to the existing framing, MIME, referrer, permissions, COOP and CORP controls.
- **Release hygiene.** Restored `.env.example` and GitHub CI configuration and made release preflight report a missing environment template as a blocker instead of crashing.

## Regression coverage

`tests/runtime/security-hardening.test.mjs` locks in the new security invariants.

## Remaining release blocker

A generated `package-lock.json` is still required before a reproducible clean production release. The release preflight intentionally treats this as a blocker. Generate it in an environment with npm registry access, then run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release:check
```
