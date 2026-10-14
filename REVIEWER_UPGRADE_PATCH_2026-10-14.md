# CellFlow reviewer hardening patch — 2026-10-14

This ZIP contains **only files changed/added** relative to the uploaded `CellFlow-main(6).zip`. It is not a repository replacement, deployed release, or evidence of a live Testnet run.

## Important fixes

1. `workflows/reconcile/src/rpc.ts`: **fail closed on missing or mismatched canonical evidence.** A COMMITTED RPC status alone is insufficient: require a valid committed block hash, header height, tip height and matching canonical `get_block_hash(height)`. Missing canonical lookup for an earlier committed block is **unknown**, not automatically `priorCommitCanonical=false`/reorg. Existing canonical snapshot remains intact when an endpoint is lagging. This addresses a potentially dangerous settlement/reorg projection.
2. `tests/integration/rpc-behavior.test.mjs`: tests missing canonical block hash, noncanonical block, valid confirmation, unavailable prior canonical query and actually contradictory prior canonical hash. Tests use an isolated local mock RPC and **do not** send blockchain writes.
3. `packages/webhooks/src/crypto.ts`: validate strict 64-digit hexadecimal HMAC before `Buffer.from(hex)` (which otherwise tolerates trailing invalid data); reject invalid timestamp/tolerance inputs. Added signature regressions.
4. `scripts/evidence/package-review-bundle.mjs`: prepare checksummed, redacted, **SHA-pinned** review artifacts from an already-completed Testnet run. Refuses incomplete/failed runs, non-Testnet identities, wrong SHA, and inconsistent release provenance. Its `--verify` mode recomputes checksums. Added isolated synthetic tests.
5. Root `package.json`: include the review regressions in `npm test` and Vercel build gate. PostgreSQL suite now includes `db-settlement.test.mjs` when `DATABASE_URL` is explicitly configured.
6. Clean-install scaffolding: `.nvmrc`, `.gitignore`, safe `.env` examples and an unprivileged GitHub Actions CI definition (see blockers below).

## Apply

Unzip the patch over the **root of your existing CellFlow repository** with paths intact, review `git diff`, then run:

```bash
npm install --package-lock-only --ignore-scripts
npm ci
npm run test:review-regressions
npm run typecheck
npm run build
npm run release:check
```

**Important:** npm's dependency registry was unreachable from the packaging environment (`EAI_AGAIN`), so this ZIP **does not include an invented package-lock.json**. You must generate and commit an authentic `package-lock.json` using npm with internet access. CI intentionally fails closed until it exists. If your repository already contains one, keep the existing valid lockfile and use `npm ci` normally.

For a separate, isolated PostgreSQL test instance, after backing it up and configuring `DATABASE_URL`:

```bash
npm run migrate
npm run test:db-integration
```

Do not run migrations indiscriminately against a shared production database. Migration 009 and settlement/reorg logic are present in the uploaded baseline; this patch does not add another DB migration.

## Reviewer evidence

After a successful **real** Testnet harness run with an already deployed CellFlow release, use its FULL 40-hex-character deployed SHA:

```bash
npm run validate:testnet-live
node scripts/evidence/package-review-bundle.mjs \
  --source evidence/testnet/live/ACTUAL_RUN_DIR \
  --out evidence/testnet/review/ACTUAL_RUN_DIR \
  --sha FULL_DEPLOYED_SHA
node scripts/evidence/package-review-bundle.mjs --verify evidence/testnet/review/ACTUAL_RUN_DIR
```

The packager validates existing artifacts, not the blockchain. It only includes evidence present in the source run; it **does not** manufacture evidence for restart/reorg/webhook cases. Manually inspect the sanitized documents for contextual or privacy-sensitive data before publication. The manifest explicitly records the limitations of the evidence.

## Production settings and limitations

- For optional post-confirmation reorg checks, configure `CELLFLOW_POST_CONFIRMATION_MONITOR_MS=3600000` (example one-hour horizon). This setting is **off by default** if absent. It is a monitoring policy, not an irreversible-finality guarantee.
- The currently supplied `vercel.json` maintenance cron runs **daily**. The durable reconciliation workflow normally handles short finite windows (up to its iteration cap), but any configured window beyond workflow lifetime needs an appropriately frequent external scheduler or plan-supported cron. Vercel plan limits and workflow executions must be checked in the deployment; changing an env var alone does not prove monitoring happened.
- Existing consumers **must** use `intent.settlement_ready` rather than `intent.confirmed` to trigger business effects, idempotently keyed by the event ID. Treat `intent.settlement_revoked` as a signal for app-owned compensation, not automatic undo.
- A Cell's `live` status is a timestamped observation, not a guarantee it will remain unspent.
- Real PostgreSQL/webhook delivery, hosted deploy SHA, Testnet two-wallet races, controlled fork and Mainnet security audit **were not executed** in this packaging environment.

## Test results in the packaging environment

- 30 core tests passed.
- 10 local mock RPC integration tests passed (includes 6 new safety cases).
- 2 HMAC signature tests passed.
- 3 reviewer bundle tests passed.
- Full `npm ci`/TypeScript workspace check/Next.js build unavailable until npm dependencies can be installed. No live Testnet transactions were initiated.

### Paths included

See `PATCH_FILES.txt` in the ZIP for the exact repo-relative file list. The archive has no unrelated source tree, private keys, node_modules or generated evidence.
