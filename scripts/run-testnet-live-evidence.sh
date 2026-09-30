#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 2; }

# Reuse the same local environment files developers normally use for CellFlow.
# Later files override earlier files; .env.testnet.local remains the strongest override.
for env_file in .env .env.local .env.production.local .env.testnet.local; do
  if [[ -f "$env_file" ]]; then
    say "Loading $env_file"
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

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

case "$CELLFLOW_URL" in
  *localhost*|*127.0.0.1*) ;;
  https://*) ;;
  *) die "Remote CELLFLOW_URL must use HTTPS" ;;
esac

if [[ -z "${CELLFLOW_API_KEY:-}" && -z "${CELLFLOW_INITIAL_ADMIN_API_KEY:-}" && -z "${CELLFLOW_BOOTSTRAP_TOKEN:-}" ]]; then
  die "No CellFlow credential source found. The runner can automatically reuse CELLFLOW_INITIAL_ADMIN_API_KEY or derive the bootstrap admin key from CELLFLOW_BOOTSTRAP_TOKEN; no separate CELLFLOW_API_KEY is required."
fi

say "Running deterministic regressions for the same CKB edge cases"
node --test \
  tests/runtime/crowdcell-review-final.test.mjs \
  tests/runtime/crowdcell-recovery-upgrade.test.mjs \
  tests/runtime/ckb-edge-hardening.test.mjs \
  tests/runtime/testnet-live-harness.test.mjs

say "Running strict multi-RPC Testnet identity preflight"
node scripts/evidence/testnet-preflight.mjs

say "Running real CKB Testnet evidence suite"
node --experimental-transform-types scripts/evidence/testnet-live-suite.mjs
