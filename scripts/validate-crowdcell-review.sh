#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-deterministic}"
export CELLFLOW_CONTENTION_GRACE_MS="${CELLFLOW_CONTENTION_GRACE_MS:-30000}"

log() { printf '\n==> %s\n' "$*"; }

if [[ ! -d node_modules ]]; then
  log "Installing workspace dependencies"
  npm install --no-audit --no-fund
fi

log "Type checking"
npm run typecheck

log "Running reviewer-specific regressions"
node --test tests/runtime/crowdcell-review-final.test.mjs tests/runtime/crowdcell-recovery-upgrade.test.mjs

log "Running core/state-machine behavior"
npm run test:core

log "Running broadcast classification and RPC behavior"
npm run test:ccc-classifier
npm run test:rpc-integration

if [[ "$MODE" == "all" || "$MODE" == "full" ]]; then
  log "Running full repository test suite"
  npm test

  if [[ -n "${DATABASE_URL:-}" ]]; then
    log "Applying migrations and running PostgreSQL integration tests"
    npm run migrate
    npm run test:db-integration
  else
    log "DATABASE_URL is not set; PostgreSQL integration was skipped"
  fi

  log "Building production web app"
  npm run build

  log "Running strict release preflight"
  npm run release:check
fi

if [[ "$MODE" == "testnet" || "$MODE" == "all" || "$MODE" == "full" ]]; then
  if [[ -n "${CKB_RPC_URL:-}" ]]; then
    log "Running CKB Testnet evidence preflight"
    npm run evidence:testnet-preflight
  else
    log "CKB_RPC_URL is not set; Testnet preflight was skipped"
  fi
fi

log "CrowdCell reviewer validation completed"
printf 'Contention grace: %sms\n' "$CELLFLOW_CONTENTION_GRACE_MS"
printf 'Mode: %s\n' "$MODE"
