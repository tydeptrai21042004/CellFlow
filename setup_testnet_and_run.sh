#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env.testnet.local ]]; then
  cp .env.testnet.example .env.testnet.local
  chmod 600 .env.testnet.local || true
  printf '\nCreated .env.testnet.local from the safe example.\n'
  printf 'Before the final run, set DATABASE_URL and one valid CellFlow credential in that file.\n'
fi

./generate_cellflow_testnet_wallets.sh "$ROOT"

printf '\nFresh wallets are funded and verified. Starting a clean reviewer evidence run.\n'
./run_testnet_local_all.sh --fresh
