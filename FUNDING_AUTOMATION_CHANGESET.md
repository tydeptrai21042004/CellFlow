# CellFlow funding automation change set

This change set implements only items that can be made reproducible in code without fabricating external evidence.

## Added/strengthened

- `.env.example` with all current runtime/funding-relevant environment keys.
- `scripts/generate-env.sh` to create a mode-600 `.env.local` with random service secrets and no wallet/private key.
- `scripts/setup-local-postgres.sh` for isolated PostgreSQL 16 local validation.
- `scripts/generate-lockfile.sh` for the still-required committed `package-lock.json`.
- `.github/workflows/ci.yml` with PostgreSQL, migration, typecheck, tests, DB integration, build, strict preflight and dependency audit.
- `scripts/clean-release-check.sh` for the same release gate locally.
- real PostgreSQL race coverage for duplicate intent creation, outbox dedupe and worker/webhook lease recovery.
- Testnet RPC/network identity preflight with machine-readable evidence.
- injected-primary-failure proof using CellFlow's actual RPC client fallback path.
- PostgreSQL process-restart proof using two separate Node.js processes.
- evidence manifest template and publication/claims guidance.
- `.nvmrc` and `.gitignore`.

## Still requires external execution or people

The code intentionally does **not** mark these as complete:

- real signed/broadcast Testnet ambiguous-response trace;
- real deployment/redeploy recovery during a chain operation;
- genuine independent RPC-provider outage evidence;
- independent CKB application integration and maintainer confirmation;
- several weeks of operational metrics;
- external security review/audit.

## Important remaining repository blocker

`package-lock.json` is not included because it must be generated from the npm registry dependency graph. Run on a machine with registry access:

```bash
bash scripts/generate-lockfile.sh
npm ci
```

Then commit the generated lockfile. `npm run release:check` is deliberately still blocked until this is done.
