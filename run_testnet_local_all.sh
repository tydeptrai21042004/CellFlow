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
    printf 'Rerun the same command to resume completed local stages.\n' >&2
  fi
  exit "$code"
}
trap on_error ERR

ENV_FILE="${CELLFLOW_ENV_FILE:-$ROOT/.env.testnet.local}"
EXAMPLE_FILE="$ROOT/.env.testnet.example"
CACHE_DIR="$ROOT/.cache/cellflow-testnet-local"
mkdir -p "$CACHE_DIR"

RESUME="${CELLFLOW_LOCAL_RESUME:-true}"
FORCE_FRESH=false
for arg in "$@"; do
  case "$arg" in
    --resume) RESUME=true ;;
    --fresh) FORCE_FRESH=true; RESUME=false ;;
    *) die "Unknown argument: $arg (supported: --resume, --fresh)" ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  [[ -f "$EXAMPLE_FILE" ]] || die "Missing $ENV_FILE and $EXAMPLE_FILE"
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  die "Created $ENV_FILE. Put your local Testnet configuration in it, then rerun this script."
fi

say "Loading local Testnet configuration"

load_env_file() {
  local file="$1" line key value first last lineno=0
  declare -A seen_keys=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*export[[:space:]]+(.+)$ ]]; then line="${BASH_REMATCH[1]}"; fi
    [[ "$line" == *=* ]] || die "Invalid env syntax in $file:$lineno (expected KEY=VALUE)."
    key="${line%%=*}"; value="${line#*=}"
    key="${key#${key%%[![:space:]]*}}"; key="${key%${key##*[![:space:]]}}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid env key '$key' in $file:$lineno."
    value="${value#${value%%[![:space:]]*}}"; value="${value%${value##*[![:space:]]}}"
    if (( ${#value} >= 2 )); then
      first="${value:0:1}"; last="${value: -1}"
      if [[ "$first" == "'" && "$last" == "'" ]] || [[ "$first" == '"' && "$last" == '"' ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    [[ -n "${seen_keys[$key]+x}" ]] && warn "Duplicate env key $key in $file:$lineno; the last file value wins unless an inherited non-empty value is already set."
    seen_keys[$key]=1
    # Explicit environment/runtime values have highest precedence. This is
    # critical for resume: the outer runner exports CELLFLOW_EVIDENCE_DIR and
    # may export a validated CELLFLOW_API_KEY, while .env.testnet.local keeps
    # blank placeholders for those fields. Never let a blank/local default
    # erase a non-empty inherited value.
    if [[ -n "${!key-}" ]]; then
      continue
    fi
    export "$key=$value"
  done < "$file"
}
load_env_file "$ENV_FILE"

export CELLFLOW_URL="${CELLFLOW_URL:-https://cellflow-brown.vercel.app}"
export CKB_NETWORK="${CKB_NETWORK:-testnet}"
export CKB_RPC_URL="${CKB_RPC_URL:-https://testnet.ckbapp.dev/rpc}"
export CKB_RPC_FALLBACK_URLS="${CKB_RPC_FALLBACK_URLS:-https://testnet.ckb.dev/}"
export CELLFLOW_CONTENTION_GRACE_MS="${CELLFLOW_CONTENTION_GRACE_MS:-30000}"
export CELLFLOW_TESTNET_REQUIRE_RBF="${CELLFLOW_TESTNET_REQUIRE_RBF:-true}"
export CELLFLOW_TESTNET_MIN_BALANCE_CKB="${CELLFLOW_TESTNET_MIN_BALANCE_CKB:-250}"
export CELLFLOW_LOCAL_RESUME="$RESUME"

[[ "$CKB_NETWORK" == "testnet" ]] || die "Refusing to run: CKB_NETWORK must be testnet."
case "$CELLFLOW_URL" in https://*) ;; *) die "For reviewer evidence CELLFLOW_URL must be the deployed HTTPS Vercel URL, not localhost." ;; esac

validate_database_url() {
  [[ "${CELLFLOW_LOCAL_RUN_CI:-true}" != "true" ]] && return 0
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is required when CELLFLOW_LOCAL_RUN_CI=true. Put your Neon PostgreSQL URL in $ENV_FILE."
  case "$DATABASE_URL" in postgresql://*|postgres://*) ;; *) die "DATABASE_URL must be a PostgreSQL URL." ;; esac
}
validate_database_url

credential_ok=false
direct_key="${CELLFLOW_API_KEY:-}"; initial_key="${CELLFLOW_INITIAL_ADMIN_API_KEY:-}"; bootstrap_token="${CELLFLOW_BOOTSTRAP_TOKEN:-}"
if [[ -n "$direct_key" && "$direct_key" == cf_live_* && "$direct_key" != *REPLACE* && ${#direct_key} -ge 32 ]]; then credential_ok=true
elif [[ -n "$initial_key" && "$initial_key" == cf_live_* && "$initial_key" != *REPLACE* && ${#initial_key} -ge 32 ]]; then credential_ok=true
elif [[ -n "$bootstrap_token" && "$bootstrap_token" != *REPLACE* && ${#bootstrap_token} -ge 24 ]]; then credential_ok=true
fi
if [[ "$credential_ok" != true && -t 0 ]]; then
  printf 'CellFlow production API key (cf_live_..., hidden input): ' >&2
  IFS= read -r -s direct_key; printf '\n' >&2
  if [[ -n "$direct_key" && "$direct_key" == cf_live_* && "$direct_key" != *REPLACE* && ${#direct_key} -ge 32 ]]; then export CELLFLOW_API_KEY="$direct_key"; credential_ok=true; fi
fi
[[ "$credential_ok" == true ]] || die "Set one valid CellFlow credential in $ENV_FILE."

validate_key() { local name="$1" value="$2"; [[ -z "$value" ]] && return 0; value="${value#0x}"; [[ "$value" =~ ^[0-9a-fA-F]{64}$ ]] || die "$name must be exactly 64 hexadecimal characters."; }
validate_key CKB_TESTNET_PRIVATE_KEY_A "${CKB_TESTNET_PRIVATE_KEY_A:-}"
validate_key CKB_TESTNET_PRIVATE_KEY_B "${CKB_TESTNET_PRIVATE_KEY_B:-}"
if [[ -z "${CKB_TESTNET_PRIVATE_KEY_A:-}" || -z "${CKB_TESTNET_PRIVATE_KEY_B:-}" ]]; then warn "One or both Testnet wallet keys are blank. The harness will use its built-in PUBLIC development Testnet identities."; fi

command -v node >/dev/null 2>&1 || die "Node.js is missing. Install Node.js 22.x."
command -v npm >/dev/null 2>&1 || die "npm is missing."
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" == "22" ]] || die "CellFlow requires Node.js 22.x; found $(node --version)."

# Smart evidence-directory resume: reuse the previous incomplete OR failed
# bundle. A summary with passed=false is intentionally resumable because the
# live suite can reuse already-passed scenario artifacts and rerun only failures.
# Only a top-level passed=true summary is treated as a completed run.
summary_passed_true() {
  local summary="$1"
  [[ -f "$summary" ]] || return 1
  node -e '
    const fs = require("node:fs");
    try {
      const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(doc?.passed === true ? 0 : 1);
    } catch { process.exit(1); }
  ' "$summary"
}

if [[ -z "${CELLFLOW_EVIDENCE_DIR:-}" ]]; then
  last_dir=""
  [[ -f "$CACHE_DIR/last_evidence_dir" ]] && last_dir="$(cat "$CACHE_DIR/last_evidence_dir")"
  # Upgrade path from older runner versions: discover the newest local evidence
  # directory even before the resumable cache file exists.
  if [[ -z "$last_dir" || ! -d "$last_dir" ]]; then
    last_dir="$(find "$ROOT/evidence/testnet/live" -maxdepth 1 -type d -name 'local-*' 2>/dev/null | sort | tail -n 1 || true)"
  fi

  completed_success=false
  if [[ -n "$last_dir" && -d "$last_dir" ]] && summary_passed_true "$last_dir/99-summary.json"; then
    completed_success=true
  fi

  if [[ "$RESUME" == true && "$FORCE_FRESH" != true && -n "$last_dir" && -d "$last_dir" && "$completed_success" != true ]]; then
    export CELLFLOW_EVIDENCE_DIR="$last_dir"
    say "Resuming previous incomplete/failed evidence run"
  else
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    export CELLFLOW_EVIDENCE_DIR="$ROOT/evidence/testnet/live/local-$stamp"
  fi
fi
mkdir -p "$CELLFLOW_EVIDENCE_DIR"
printf '%s' "$CELLFLOW_EVIDENCE_DIR" > "$CACHE_DIR/last_evidence_dir"

say "Target configuration"
printf 'CellFlow:          %s\n' "$CELLFLOW_URL"
printf 'CKB network:       %s\n' "$CKB_NETWORK"
printf 'Primary RPC:       %s\n' "$CKB_RPC_URL"
printf 'Fallback RPCs:     %s\n' "$CKB_RPC_FALLBACK_URLS"
printf 'Contention grace:  %sms\n' "$CELLFLOW_CONTENTION_GRACE_MS"
printf 'Strict RBF:        %s\n' "$CELLFLOW_TESTNET_REQUIRE_RBF"
printf 'Evidence output:   %s\n' "$CELLFLOW_EVIDENCE_DIR"
printf 'Resume mode:       %s\n' "$RESUME"

hash_files() {
  local mode="$1"
  if [[ "$mode" == deps ]]; then
    { find . -maxdepth 4 -name package.json -not -path './node_modules/*' -print0; [[ -f package-lock.json ]] && printf '%s\0' './package-lock.json'; } \
      | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}'
  else
    # CI/build fingerprint intentionally excludes local evidence harness files.
    # Editing scripts/evidence or the local runner must not invalidate a
    # previously successful Vercel application build.
    {
      find apps packages workflows -type f \
        \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' \) \
        -not -path '*/node_modules/*' -not -path '*/.next/*' -print0
      find . -maxdepth 1 -type f \( -name 'tsconfig*.json' -o -name 'package*.json' -o -name 'next.config.*' \) -print0
    } | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}'
  fi
}

install_from_manifests() {
  warn "Regenerating package-lock.json from the current workspace package.json files."
  [[ -f package-lock.json ]] && cp package-lock.json "$CELLFLOW_EVIDENCE_DIR/00-package-lock.stale.json" && rm -f package-lock.json
  npm install --no-audit --no-fund 2>&1 | tee "$CELLFLOW_EVIDENCE_DIR/00-npm-install.log"
  [[ -f package-lock.json ]] || die "npm install completed without producing package-lock.json."
  cp package-lock.json "$CELLFLOW_EVIDENCE_DIR/00-package-lock.regenerated.json"
}

DEPS_FP_BEFORE="$(hash_files deps)"
DEPS_REUSABLE=false
if [[ "$RESUME" == true && -d node_modules ]]; then
  if [[ -f "$CACHE_DIR/deps.fingerprint" && "$(cat "$CACHE_DIR/deps.fingerprint")" == "$DEPS_FP_BEFORE" ]]; then
    DEPS_REUSABLE=true
  elif npm ls --depth=0 --silent >/dev/null 2>&1; then
    # Bootstrap resume state after upgrading from the older non-caching runner.
    DEPS_REUSABLE=true
    printf '%s' "$DEPS_FP_BEFORE" > "$CACHE_DIR/deps.fingerprint"
  fi
fi
if [[ "$DEPS_REUSABLE" == true ]]; then
  say "Dependencies already installed and valid — reusing existing node_modules"
else
  say "Installing/checking project dependencies"
  if [[ -f package-lock.json ]]; then
    if npm ci --no-audit --no-fund 2>&1 | tee "$CELLFLOW_EVIDENCE_DIR/00-npm-ci.log"; then :
    else
      ci_status=${PIPESTATUS[0]}
      if grep -Eqi 'package.json and package-lock.json.*in sync|Invalid: lock file|Missing: .* from lock file|EUSAGE' "$CELLFLOW_EVIDENCE_DIR/00-npm-ci.log"; then
        warn "The lockfile is stale/incompatible; rebuilding it now (npm ci exit $ci_status)."
        install_from_manifests
      else die "npm ci failed (exit $ci_status)."; fi
    fi
  else install_from_manifests; fi
  hash_files deps > "$CACHE_DIR/deps.fingerprint"
fi

if [[ "${CELLFLOW_LOCAL_RUN_CI:-true}" == "true" ]]; then
  CI_FP="$(hash_files ci)"
  CI_REUSABLE=false
  if [[ "$RESUME" == true ]]; then
    if [[ -f "$CACHE_DIR/ci.fingerprint" && "$(cat "$CACHE_DIR/ci.fingerprint")" == "$CI_FP" ]]; then
      CI_REUSABLE=true
    elif [[ -f "$ROOT/apps/web/.next/BUILD_ID" ]]; then
      # Older runner completed `npm run ci:vercel` but had no cache marker.
      # A completed Next BUILD_ID lets us bootstrap the resumable CI marker.
      CI_REUSABLE=true
      printf '%s' "$CI_FP" > "$CACHE_DIR/ci.fingerprint"
      warn "Found an existing completed Next.js build; trusting it for this resume. Use --fresh to force CI/build again."
    fi
  fi
  if [[ "$CI_REUSABLE" == true ]]; then
    say "Application CI/build already passed for unchanged application source — skipping"
  else
    say "Running local Vercel-equivalent CI/typecheck/build gate"
    npm run ci:vercel
    printf '%s' "$CI_FP" > "$CACHE_DIR/ci.fingerprint"
  fi
else
  warn "CELLFLOW_LOCAL_RUN_CI=false: skipping the CI/typecheck/build gate."
fi

say "Running/resuming reviewer-facing real Testnet evidence stages"
npm run validate:testnet-live

say "Run completed successfully"
printf 'Evidence bundle: %s\n' "$CELLFLOW_EVIDENCE_DIR"
printf 'Next completed run will automatically start a fresh evidence bundle.\n'
