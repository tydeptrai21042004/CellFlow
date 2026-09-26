#!/usr/bin/env bash
set -Eeuo pipefail

# CellFlow local/Testnet environment bootstrap
# Usage:
#   bash cellflow_testnet_setup.sh /path/to/CellFlow-main
#
# Optional environment overrides:
#   DATABASE_URL=...
#   CKB_RPC_URL=...
#   CKB_RPC_FALLBACK_URLS=...
#   CELLFLOW_PG_PORT=54329
#
# This script does NOT create/import a wallet and never asks for a private key.
# Keep signing keys in your wallet/test harness, not in CellFlow .env files.

REPO="${1:-$PWD}"
PG_PORT="${CELLFLOW_PG_PORT:-54329}"
PG_CONTAINER="${CELLFLOW_PG_CONTAINER:-cellflow-postgres}"
PG_USER="${CELLFLOW_PG_USER:-cellflow}"
PG_PASSWORD="${CELLFLOW_PG_PASSWORD:-cellflow_local_only}"
PG_DB="${CELLFLOW_PG_DB:-cellflow}"

DEFAULT_RPC="https://testnet.ckbapp.dev/rpc"
CKB_RPC_URL="${CKB_RPC_URL:-$DEFAULT_RPC}"
CKB_RPC_FALLBACK_URLS="${CKB_RPC_FALLBACK_URLS:-}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is missing. Install Node.js 22+ first."
command -v npm >/dev/null 2>&1 || die "npm is missing."
command -v curl >/dev/null 2>&1 || die "curl is missing."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 22 )) || die "CellFlow requires Node.js 22+. Found: $(node -v)"

cd "$REPO"
[[ -f package.json ]] || die "package.json not found in $REPO"
grep -q '"name": "cellflow"' package.json || warn "This directory does not look like the CellFlow repository."

say "Checking repository release prerequisites"
if [[ ! -f .env.example ]]; then
  warn ".env.example is missing in this ZIP. Fix/restore it in the repository; current runtime tests expect it."
fi
if [[ ! -f .github/workflows/ci.yml ]]; then
  warn ".github/workflows/ci.yml is missing in this ZIP. Fix/restore it before claiming a clean release."
fi

say "Preparing local PostgreSQL"
if [[ -z "${DATABASE_URL:-}" ]]; then
  command -v docker >/dev/null 2>&1 || die \
    "DATABASE_URL is not set and Docker is unavailable. Set DATABASE_URL to a PostgreSQL/Neon database or install Docker."

  if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    docker run -d \
      --name "$PG_CONTAINER" \
      -e POSTGRES_USER="$PG_USER" \
      -e POSTGRES_PASSWORD="$PG_PASSWORD" \
      -e POSTGRES_DB="$PG_DB" \
      -p "${PG_PORT}:5432" \
      postgres:16-alpine >/dev/null
  else
    if [[ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER")" != "true" ]]; then
      docker start "$PG_CONTAINER" >/dev/null
    fi
  fi

  DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}"
fi
export DATABASE_URL

say "Checking CKB Testnet RPC identity"
RPC_INFO="$(
  curl -fsS --max-time 12 \
    -H 'content-type: application/json' \
    -d '{"id":1,"jsonrpc":"2.0","method":"get_blockchain_info","params":[]}' \
    "$CKB_RPC_URL"
)" || die "Cannot reach CKB RPC: $CKB_RPC_URL"

RPC_CHAIN="$(node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const x=JSON.parse(s);
  if (x.error) process.exit(2);
  console.log(x.result?.chain ?? "");
});' <<<"$RPC_INFO")"

[[ "$RPC_CHAIN" == "ckb_testnet" ]] || die \
  "RPC does not report ckb_testnet (reported: ${RPC_CHAIN:-unknown}). Refusing to continue."

GENESIS_JSON="$(
  curl -fsS --max-time 12 \
    -H 'content-type: application/json' \
    -d '{"id":2,"jsonrpc":"2.0","method":"get_block_hash","params":["0x0"]}' \
    "$CKB_RPC_URL"
)"
CKB_EXPECTED_GENESIS_HASH="$(node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const x=JSON.parse(s);
  if (x.error || typeof x.result !== "string") process.exit(2);
  console.log(x.result);
});' <<<"$GENESIS_JSON")"

export CKB_NETWORK="testnet"
export CKB_RPC_URL
export CKB_RPC_FALLBACK_URLS
export CKB_EXPECTED_GENESIS_HASH
export CKB_RPC_TIMEOUT_MS="${CKB_RPC_TIMEOUT_MS:-10000}"
export CKB_RPC_CIRCUIT_FAILURES="${CKB_RPC_CIRCUIT_FAILURES:-2}"
export CKB_RPC_CIRCUIT_COOLDOWN_MS="${CKB_RPC_CIRCUIT_COOLDOWN_MS:-30000}"
export DEFAULT_CONFIRMATION_POLICY="${DEFAULT_CONFIRMATION_POLICY:-depth:4}"
export CELLFLOW_RATE_LIMIT_PER_MINUTE="${CELLFLOW_RATE_LIMIT_PER_MINUTE:-240}"
export CELLFLOW_MAX_JSON_BODY_BYTES="${CELLFLOW_MAX_JSON_BODY_BYTES:-262144}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
export CELLFLOW_SETUP_ENABLED="${CELLFLOW_SETUP_ENABLED:-true}"

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
  fi
}

export CELLFLOW_ENCRYPTION_KEY="${CELLFLOW_ENCRYPTION_KEY:-$(random_secret)}"
export CELLFLOW_BOOTSTRAP_TOKEN="${CELLFLOW_BOOTSTRAP_TOKEN:-$(random_secret)}"
export CRON_SECRET="${CRON_SECRET:-$(random_secret)}"

say "Writing .env.local (no wallet/private key is stored here)"
cat > .env.local <<EOF
DATABASE_URL=${DATABASE_URL}
CKB_NETWORK=testnet
CKB_RPC_URL=${CKB_RPC_URL}
CKB_RPC_FALLBACK_URLS=${CKB_RPC_FALLBACK_URLS}
CKB_RPC_TIMEOUT_MS=${CKB_RPC_TIMEOUT_MS}
CKB_RPC_CIRCUIT_FAILURES=${CKB_RPC_CIRCUIT_FAILURES}
CKB_RPC_CIRCUIT_COOLDOWN_MS=${CKB_RPC_CIRCUIT_COOLDOWN_MS}
CKB_EXPECTED_GENESIS_HASH=${CKB_EXPECTED_GENESIS_HASH}
CELLFLOW_ENCRYPTION_KEY=${CELLFLOW_ENCRYPTION_KEY}
CELLFLOW_BOOTSTRAP_TOKEN=${CELLFLOW_BOOTSTRAP_TOKEN}
CELLFLOW_SETUP_ENABLED=${CELLFLOW_SETUP_ENABLED}
CELLFLOW_RATE_LIMIT_PER_MINUTE=${CELLFLOW_RATE_LIMIT_PER_MINUTE}
CELLFLOW_MAX_JSON_BODY_BYTES=${CELLFLOW_MAX_JSON_BODY_BYTES}
CRON_SECRET=${CRON_SECRET}
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
DEFAULT_CONFIRMATION_POLICY=${DEFAULT_CONFIRMATION_POLICY}
EOF
chmod 600 .env.local

say "Installing dependencies"
if [[ -f package-lock.json ]]; then
  npm ci
else
  warn "package-lock.json is missing. Running npm install to generate one; commit it for reproducible releases."
  npm install
fi

say "Waiting for PostgreSQL"
for _ in $(seq 1 30); do
  if node -e '
    import("postgres").then(async ({default: postgres}) => {
      const sql=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:2});
      try { await sql`select 1`; await sql.end(); process.exit(0); }
      catch { try { await sql.end({timeout:0}); } catch {} process.exit(1); }
    });
  ' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

say "Applying database migrations"
npm run migrate

say "Running deterministic repository checks"
# These can still fail until the repository-level P0 files (.env.example / CI)
# are restored. That is intentional: setup must not hide release inconsistencies.
npm test || warn "npm test failed. Fix repository test/release issues before Testnet evidence collection."
npm run typecheck || warn "typecheck failed."
npm run build || warn "production build failed."
npm run release:report || true

say "Environment ready"
cat <<EOF

CKB network:       ${RPC_CHAIN}
CKB RPC:           ${CKB_RPC_URL}
Genesis hash:      ${CKB_EXPECTED_GENESIS_HASH}
Database:          ${DATABASE_URL}
Environment file:  ${REPO}/.env.local

Next:
  1. Fix any repository-level test/release failures reported above.
  2. Start CellFlow:
       cd "${REPO}"
       set -a; source .env.local; set +a
       npm run dev

  3. Create/use a TESTNET-ONLY funded wallet separately.
     Do not place its private key in .env.local.

  4. Run the future Testnet input-race harness:
       one live Cell C0
          -> sign Tx A consuming C0
          -> sign Tx B consuming the same C0
          -> broadcast A
          -> submit/reconcile B through CellFlow
          -> capture MEMPOOL_CONTENDED / INPUT_SPENT_OBSERVED / INPUT_SPENT

This script deliberately does NOT broadcast transactions or handle signing keys.
EOF
