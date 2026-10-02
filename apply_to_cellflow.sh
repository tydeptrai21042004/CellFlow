#!/usr/bin/env bash
set -euo pipefail
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"
[[ -f "$TARGET/package.json" ]] || { echo "ERROR: target does not look like CellFlow repo: $TARGET" >&2; exit 2; }
for f in \
  .env.testnet.example \
  .gitignore \
  generate_cellflow_testnet_wallets.sh \
  setup_testnet_and_run.sh \
  packages/ccc/src/client.ts \
  run_testnet_local_all.sh \
  scripts/evidence/testnet-live-reconcile-worker.mjs \
  scripts/evidence/testnet-live-suite.mjs \
  scripts/evidence/testnet-preflight.mjs \
  scripts/run-testnet-live-evidence.sh \
  tests/runtime/testnet-live-harness.test.mjs; do
  mkdir -p "$TARGET/$(dirname "$f")"
  cp -a "$PATCH_DIR/$f" "$TARGET/$f"
done
chmod +x "$TARGET/run_testnet_local_all.sh" "$TARGET/generate_cellflow_testnet_wallets.sh" "$TARGET/setup_testnet_and_run.sh" "$TARGET/scripts/run-testnet-live-evidence.sh"
echo "Applied CellFlow Testnet patch to: $TARGET"
echo "Your existing .env.testnet.local was not touched."
