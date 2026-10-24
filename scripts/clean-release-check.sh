#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The same no-database, no-env-file install policy used by GitHub Actions.
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  echo "WARN: package-lock.json absent; installing without a generated lockfile." >&2
  npm install --package-lock=false --no-audit --no-fund
fi

npm run typecheck
npm test

# DB tests are opt-in. Never connect this release script to the Vercel database
# unless an operator deliberately configured a separate disposable test database.
if [[ "${CELLFLOW_RUN_DB_TESTS:-false}" == "true" ]]; then
  [[ -n "${DATABASE_URL:-}" ]] || { echo 'ERROR: CELLFLOW_RUN_DB_TESTS=true requires an isolated DATABASE_URL.' >&2; exit 1; }
  npm run migrate
  npm run test:db-integration
else
  echo 'INFO: DB integration checks not requested (hosted Vercel database unchanged).'
fi

npm run build
npm run release:check

echo "Clean release checks passed."
