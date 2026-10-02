#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 2; }

on_error() {
  local code=$?
  printf '\n\033[1;31mFAILED (exit %s).\033[0m\n' "$code" >&2
  if [[ -n "${CELLFLOW_EVIDENCE_DIR:-}" ]]; then
    printf 'Evidence/output directory: %s\n' "$CELLFLOW_EVIDENCE_DIR" >&2
  fi
  exit "$code"
}
trap on_error ERR

ENV_FILE="${CELLFLOW_ENV_FILE:-$ROOT/.env.testnet.local}"
EXAMPLE_FILE="$ROOT/.env.testnet.example"

if [[ ! -f "$ENV_FILE" ]]; then
  [[ -f "$EXAMPLE_FILE" ]] || die "Missing $ENV_FILE and $EXAMPLE_FILE"
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  die "Created $ENV_FILE. Put your CellFlow cf_live_ API key in it, then rerun this script."
fi

say "Loading local Testnet configuration"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Defaults remain explicit here so a minimal env file still targets the deployed app.
export CELLFLOW_URL="${CELLFLOW_URL:-https://cellflow-brown.vercel.app}"
export CKB_NETWORK="${CKB_NETWORK:-testnet}"
export CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckbapp.dev/rpc}"
export CKB_RPC_FALLBACK_URLS="${CKB_RPC_FALLBACK_URLS:-https://testnet.ckb.dev/}"
export CELLFLOW_CONTENTION_GRACE_MS="${CELLFLOW_CONTENTION_GRACE_MS:-30000}"
export CELLFLOW_TESTNET_REQUIRE_RBF="${CELLFLOW_TESTNET_REQUIRE_RBF:-true}"
export CELLFLOW_TESTNET_MIN_BALANCE_CKB="${CELLFLOW_TESTNET_MIN_BALANCE_CKB:-250}"

[[ "$CKB_NETWORK" == "testnet" ]] || die "Refusing to run: CKB_NETWORK must be testnet."
case "$CELLFLOW_URL" in
  https://*) ;;
  *) die "For reviewer evidence CELLFLOW_URL must be the deployed HTTPS Vercel URL, not localhost." ;;
esac

credential_ok=false
direct_key="${CELLFLOW_API_KEY:-}"
initial_key="${CELLFLOW_INITIAL_ADMIN_API_KEY:-}"
bootstrap_token="${CELLFLOW_BOOTSTRAP_TOKEN:-}"
if [[ -n "$direct_key" && "$direct_key" == cf_live_* && "$direct_key" != *REPLACE* && ${#direct_key} -ge 32 ]]; then
  credential_ok=true
elif [[ -n "$initial_key" && "$initial_key" == cf_live_* && "$initial_key" != *REPLACE* && ${#initial_key} -ge 32 ]]; then
  credential_ok=true
elif [[ -n "$bootstrap_token" && "$bootstrap_token" != *REPLACE* && ${#bootstrap_token} -ge 24 ]]; then
  credential_ok=true
fi

# Make the local path one-command friendly: when the template still contains the
# placeholder, ask once for the production project key without writing it to disk.
if [[ "$credential_ok" != true && -t 0 ]]; then
  printf 'CellFlow production API key (cf_live_..., hidden input): ' >&2
  IFS= read -r -s direct_key
  printf '\n' >&2
  if [[ -n "$direct_key" && "$direct_key" == cf_live_* && "$direct_key" != *REPLACE* && ${#direct_key} -ge 32 ]]; then
    export CELLFLOW_API_KEY="$direct_key"
    credential_ok=true
  fi
fi
[[ "$credential_ok" == true ]] || die "Set ONE valid CellFlow credential in $ENV_FILE (or paste it at the interactive prompt): CELLFLOW_API_KEY, CELLFLOW_INITIAL_ADMIN_API_KEY, or CELLFLOW_BOOTSTRAP_TOKEN."

validate_key() {
  local name="$1" value="$2"
  [[ -z "$value" ]] && return 0
  value="${value#0x}"
  [[ "$value" =~ ^[0-9a-fA-F]{64}$ ]] || die "$name must be exactly 64 hexadecimal characters (optional 0x prefix)."
}
validate_key CKB_TESTNET_PRIVATE_KEY_A "${CKB_TESTNET_PRIVATE_KEY_A:-}"
validate_key CKB_TESTNET_PRIVATE_KEY_B "${CKB_TESTNET_PRIVATE_KEY_B:-}"

if [[ -n "${CKB_TESTNET_PRIVATE_KEY_A:-}" && -n "${CKB_TESTNET_PRIVATE_KEY_B:-}" ]]; then
  [[ "${CKB_TESTNET_PRIVATE_KEY_A#0x}" != "${CKB_TESTNET_PRIVATE_KEY_B#0x}" ]] || die "Wallet A and wallet B must use different Testnet private keys."
else
  warn "One or both Testnet wallet keys are blank. The harness will use its built-in PUBLIC development Testnet identities. Use fresh faucet-funded Testnet-only wallets for the final reviewer bundle."
fi

command -v node >/dev/null 2>&1 || die "Node.js is missing. Install Node.js 22.x."
command -v npm >/dev/null 2>&1 || die "npm is missing. Install npm with Node.js 22.x."
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" == "22" ]] || die "CellFlow requires Node.js 22.x; found $(node --version)."

if [[ -z "${CELLFLOW_EVIDENCE_DIR:-}" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  export CELLFLOW_EVIDENCE_DIR="$ROOT/evidence/testnet/live/local-$stamp"
fi
mkdir -p "$CELLFLOW_EVIDENCE_DIR"

say "Target configuration"
printf 'CellFlow:          %s\n' "$CELLFLOW_URL"
printf 'CKB network:       %s\n' "$CKB_NETWORK"
printf 'Primary RPC:       %s\n' "$CKB_RPC_URL"
printf 'Fallback RPCs:     %s\n' "$CKB_RPC_FALLBACK_URLS"
printf 'Contention grace:  %sms\n' "$CELLFLOW_CONTENTION_GRACE_MS"
printf 'Strict RBF:        %s\n' "$CELLFLOW_TESTNET_REQUIRE_RBF"
printf 'Evidence output:   %s\n' "$CELLFLOW_EVIDENCE_DIR"
printf 'Minimum/wallet:    %s CKB\n' "$CELLFLOW_TESTNET_MIN_BALANCE_CKB"

say "Installing exact project dependencies available from the repository"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  warn "package-lock.json is absent; using npm install. Commit the generated lockfile before publishing a reproducible final evidence run."
  npm install --no-audit --no-fund
fi

if [[ "${CELLFLOW_LOCAL_RUN_CI:-true}" == "true" ]]; then
  say "Running local Vercel-equivalent CI/typecheck/build gate"
  npm run ci:vercel
else
  warn "CELLFLOW_LOCAL_RUN_CI=false: skipping the CI/typecheck/build gate."
fi

say "Running all reviewer-facing real Testnet evidence scenarios"
npm run validate:testnet-live

say "Run completed successfully"
printf 'Evidence bundle: %s\n' "$CELLFLOW_EVIDENCE_DIR"
if [[ -f "$CELLFLOW_EVIDENCE_DIR/99-summary.json" ]]; then
  printf 'Summary:         %s/99-summary.json\n' "$CELLFLOW_EVIDENCE_DIR"
fi
if [[ -f "$CELLFLOW_EVIDENCE_DIR/SHA256SUMS" ]]; then
  printf 'Checksums:       %s/SHA256SUMS\n' "$CELLFLOW_EVIDENCE_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    say "Verifying evidence checksums"
    (cd "$CELLFLOW_EVIDENCE_DIR" && sha256sum -c SHA256SUMS)
  fi
fi
