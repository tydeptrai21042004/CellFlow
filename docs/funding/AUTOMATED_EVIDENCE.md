# Funding evidence automation

This change set automates what can be made reproducible without pretending that external validation already happened.

## One-time setup

```bash
bash scripts/generate-env.sh
set -a; source .env.local; set +a
bash scripts/setup-local-postgres.sh   # only for local PostgreSQL
bash scripts/generate-lockfile.sh      # requires npm registry access
npm ci
npm run migrate
```

If you use Neon/PostgreSQL already, export `DATABASE_URL` before `generate-env.sh` and skip the Docker database script.

For funding-grade RPC evidence, configure a primary and at least one independently operated fallback:

```bash
export CKB_RPC_URL='https://PRIMARY/...'
export CKB_RPC_FALLBACK_URLS='https://FALLBACK/...'
bash scripts/generate-env.sh
set -a; source .env.local; set +a
```

Then run:

```bash
npm run evidence:testnet-preflight
npm run evidence:rpc-failover
npm run evidence:db-restart
npm run test:db-integration
```

## Release gate

```bash
bash scripts/clean-release-check.sh
```

This intentionally fails if `package-lock.json` has not been generated and committed.

## Claims discipline

- `rpc-failover-proof.mjs` injects an unusable primary and therefore proves the fallback path, **not** a genuine provider outage.
- `db-restart-proof.mjs` proves PostgreSQL persistence across an OS process boundary, **not** a real Vercel redeploy during a blockchain transaction.
- Real Testnet broadcast/recovery, independent adoption, operational history, and external security review remain external funding evidence.
