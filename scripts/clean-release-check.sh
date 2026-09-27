#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f package-lock.json ]] || {
  echo "ERROR: package-lock.json is required. Run: bash scripts/generate-lockfile.sh" >&2
  exit 1
}

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

npm ci
npm run typecheck
npm test

if [[ -n "${DATABASE_URL:-}" ]]; then
  npm run migrate
  npm run test:db-integration
else
  echo "WARN: DATABASE_URL not set; DB integration checks skipped." >&2
fi

npm run build
npm run release:check

echo "Clean release checks passed."
