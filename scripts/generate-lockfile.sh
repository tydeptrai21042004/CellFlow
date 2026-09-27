#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js 22+ required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm required" >&2; exit 1; }

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 22 )) || { echo "ERROR: Node.js 22+ required; found $(node -v)" >&2; exit 1; }

EXPECTED_NPM="$(node -p 'require("./package.json").packageManager || ""')"
echo "Node: $(node -v)"
echo "npm:  $(npm -v) (package.json declares $EXPECTED_NPM)"

echo "Generating package-lock.json from exact workspace manifests..."
npm install --package-lock-only --ignore-scripts

test -s package-lock.json || { echo "ERROR: package-lock.json was not generated" >&2; exit 1; }
node -e '
  const p=require("./package-lock.json");
  if (p.lockfileVersion < 3) throw new Error("Expected npm lockfileVersion >= 3");
  console.log(`package-lock.json OK (lockfileVersion=${p.lockfileVersion})`);
'

echo "Now commit package-lock.json, then verify with: npm ci"
