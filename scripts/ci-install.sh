#!/usr/bin/env bash
# CellFlow GitHub Actions dependency bootstrap.
# Deliberately independent of DATABASE_URL, migrations, PostgreSQL and funded wallets.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
  echo 'Dependency lockfile committed: enforcing frozen npm ci.'
  npm ci --no-audit --no-fund
  exit 0
fi

# The previous CI implementation generated a lock-only tree and immediately
# passed it to npm ci. npm can produce an incomplete lock for mixed major peer
# dependency trees (e.g. Zod 3 + 4), triggering EUSAGE before installing any
# modules. A real install is needed on this temporary no-lockfile path.
echo '::warning::No committed lockfile: using a real npm install for this run. This run is NOT a reproducible dependency release.'
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo 'CELLFLOW_EPHEMERAL_LOCKFILE=true' >> "$GITHUB_ENV"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' '⚠️ No source lockfile: dependencies were freshly resolved. Only an independently validated generated lockfile will be uploaded.' >> "$GITHUB_STEP_SUMMARY"
fi

npm install --no-audit --no-fund
if [[ ! -s package-lock.json ]]; then
  echo '::error::npm install did not produce a usable package-lock.json'
  exit 1
fi

# Validate the proposed artifact without reinstalling (or deleting) the
# working node_modules tree. A broken provisional lockfile must NEVER be
# offered to the repository owner as ready to commit.
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
lock_valid=false
if npm ci --dry-run --ignore-scripts --no-audit --no-fund > "$log" 2>&1; then
  lock_valid=true
else
  echo '::warning::npm ci rejected the provisional lockfile. Attempting npm lockfile normalization.'
  # Some npm versions need a second package-lock-only serialization pass.
  if npm install --package-lock-only --ignore-scripts --no-audit --no-fund; then
    if npm ci --dry-run --ignore-scripts --no-audit --no-fund > "$log" 2>&1; then
      lock_valid=true
    fi
  fi
fi

if [[ "$lock_valid" == true ]]; then
  echo 'Generated lockfile accepted by npm ci --dry-run.'
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo 'CELLFLOW_VALIDATED_LOCKFILE=true' >> "$GITHUB_ENV"
  fi
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' '✅ Provisional lockfile passed npm ci --dry-run. Download the lockfile artifact, commit it, and let a fresh CI run verify a full `npm ci`.' >> "$GITHUB_STEP_SUMMARY"
  fi
else
  echo '::warning::Generated lockfile is NOT accepted by npm ci; not uploading a broken proposed lockfile. Offline checks continue using the successfully installed dependencies.'
  # Keep this diagnostic short and redact any unexpected tokens in npm output
  # by not printing the raw npm error log in a public workflow.
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' '⚠️ npm ci rejected the provisional lockfile. Do not commit it. Fix it on a networked workstation and verify a clean npm ci before committing.' >> "$GITHUB_STEP_SUMMARY"
  fi
fi
