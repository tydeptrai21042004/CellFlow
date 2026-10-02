#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 2; }

# The outer local runner already exports a safely parsed .env.testnet.local.
# For direct invocation, only source conventional files that are valid shell;
# .env.testnet.local is parsed literally here to preserve URLs containing '&'.
load_literal_env() {
  local file="$1" line key value first last
  [[ -f "$file" ]] || return 0
  say "Loading $file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"; value="${line#*=}"
    key="${key#${key%%[![:space:]]*}}"; key="${key%${key##*[![:space:]]}}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="${value#${value%%[![:space:]]*}}"; value="${value%${value##*[![:space:]]}}"
    if (( ${#value} >= 2 )); then first="${value:0:1}"; last="${value: -1}"; [[ ( "$first" == "'" && "$last" == "'" ) || ( "$first" == '"' && "$last" == '"' ) ]] && value="${value:1:${#value}-2}"; fi
    # Runtime/inherited values win over the file. In particular, preserve the
    # outer runner's evidence directory and validated API key when this file
    # contains CELLFLOW_EVIDENCE_DIR= or another blank placeholder.
    if [[ -n "${!key-}" ]]; then
      continue
    fi
    export "$key=$value"
  done < "$file"
}
for env_file in .env .env.local .env.production.local; do
  if [[ -f "$env_file" ]]; then set -a; source "$env_file"; set +a; fi
done
load_literal_env .env.testnet.local

export CELLFLOW_URL="${CELLFLOW_URL:-https://cellflow-brown.vercel.app}"
export CKB_NETWORK="${CKB_NETWORK:-testnet}"
export CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckbapp.dev/rpc}"
export CKB_RPC_FALLBACK_URLS="${CKB_RPC_FALLBACK_URLS:-https://testnet.ckb.dev/}"
export CELLFLOW_TESTNET_REQUIRE_RBF="${CELLFLOW_TESTNET_REQUIRE_RBF:-true}"
export CELLFLOW_CONTENTION_GRACE_MS="${CELLFLOW_CONTENTION_GRACE_MS:-30000}"
export CELLFLOW_TESTNET_SAME_FEE_RATE="${CELLFLOW_TESTNET_SAME_FEE_RATE:-1000}"
export CELLFLOW_TESTNET_LOW_FEE_RATE="${CELLFLOW_TESTNET_LOW_FEE_RATE:-1000}"
export CELLFLOW_TESTNET_HIGH_FEE_RATE="${CELLFLOW_TESTNET_HIGH_FEE_RATE:-20000}"
export CELLFLOW_TESTNET_TIMEOUT_MS="${CELLFLOW_TESTNET_TIMEOUT_MS:-900000}"
export CELLFLOW_TESTNET_MIN_BALANCE_CKB="${CELLFLOW_TESTNET_MIN_BALANCE_CKB:-250}"

[[ "$CKB_NETWORK" == "testnet" ]] || die "This harness is Testnet-only. CKB_NETWORK must be testnet."
if [[ -z "${CELLFLOW_API_KEY:-}" && -z "${CELLFLOW_INITIAL_ADMIN_API_KEY:-}" && -z "${CELLFLOW_BOOTSTRAP_TOKEN:-}" ]]; then die "No CellFlow credential source found. The runner can reuse CELLFLOW_INITIAL_ADMIN_API_KEY or derive the bootstrap admin key from CELLFLOW_BOOTSTRAP_TOKEN; no separate CELLFLOW_API_KEY is required."; fi

STATE_DIR="${CELLFLOW_EVIDENCE_DIR:-$ROOT/evidence/testnet/live/direct}/.state"
mkdir -p "$STATE_DIR"
RESUME="${CELLFLOW_LOCAL_RESUME:-true}"

# Upgrade path: if an older runner reached the live suite and wrote a failure
# artifact, deterministic regressions necessarily completed before it. Preserve
# that work when enabling resume for the first time.
if [[ "$RESUME" == true && -n "${CELLFLOW_EVIDENCE_DIR:-}" && -f "$CELLFLOW_EVIDENCE_DIR/99-failure.json" && ! -f "$STATE_DIR/deterministic.ok" ]]; then
  date -u +%FT%TZ > "$STATE_DIR/deterministic.ok"
fi

if [[ "$RESUME" == true && -f "$STATE_DIR/deterministic.ok" ]]; then
  say "Deterministic regressions already passed in this evidence run — skipping"
else
  say "Running deterministic regressions for the same CKB edge cases"
  node --test \
    tests/runtime/crowdcell-review-final.test.mjs \
    tests/runtime/crowdcell-recovery-upgrade.test.mjs \
    tests/runtime/ckb-edge-hardening.test.mjs \
    tests/runtime/testnet-live-harness.test.mjs
  date -u +%FT%TZ > "$STATE_DIR/deterministic.ok"
fi

if [[ "$RESUME" == true && -f "$STATE_DIR/preflight.ok" && -f "${CELLFLOW_EVIDENCE_DIR:-}/00-testnet-preflight.json" ]]; then
  say "Strict multi-RPC Testnet identity preflight already passed — skipping"
else
  say "Running strict multi-RPC Testnet identity preflight"
  preflight_attempts="${CELLFLOW_TESTNET_PREFLIGHT_ATTEMPTS:-3}"
  preflight_delay="${CELLFLOW_TESTNET_PREFLIGHT_RETRY_DELAY_SEC:-2}"
  preflight_output=""
  preflight_status=2
  for ((attempt=1; attempt<=preflight_attempts; attempt++)); do
    if preflight_output="$(node scripts/evidence/testnet-preflight.mjs)"; then
      preflight_status=0
    else
      preflight_status=$?
    fi
    # Always print the JSON, including failed endpoint diagnostics. Previously
    # `set -e` aborted inside command substitution and hid the useful evidence.
    printf '%s\n' "$preflight_output"
    if [[ "$preflight_status" -eq 0 ]]; then
      break
    fi
    if (( attempt < preflight_attempts )); then
      printf 'WARN: Testnet identity preflight attempt %d/%d failed (exit %d); retrying in %ss.\n' \
        "$attempt" "$preflight_attempts" "$preflight_status" "$preflight_delay" >&2
      sleep "$preflight_delay"
    fi
  done
  [[ "$preflight_status" -eq 0 ]] || die "Strict Testnet identity preflight failed after $preflight_attempts attempts. See the JSON above for the endpoint that failed."
  generated_path="$(printf '%s' "$preflight_output" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).output||"")}catch{}})')"
  if [[ -n "$generated_path" && -f "$generated_path" && -n "${CELLFLOW_EVIDENCE_DIR:-}" ]]; then
    cp "$generated_path" "$CELLFLOW_EVIDENCE_DIR/00-testnet-preflight.json"
  fi
  date -u +%FT%TZ > "$STATE_DIR/preflight.ok"
fi

say "Running real CKB Testnet evidence suite"
node --experimental-transform-types scripts/evidence/testnet-live-suite.mjs
