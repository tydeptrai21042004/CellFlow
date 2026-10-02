#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${1:-$(pwd)}"
ENV_FILE="${ROOT_DIR}/.env.testnet.local"
ADDR_FILE="${ROOT_DIR}/.testnet-wallet-addresses.txt"
BACKUP_DIR="${ROOT_DIR}/.cache/cellflow-testnet-wallets"
RPC_URL="${CKB_RPC_URL:-https://testnet.ckb.dev/}"
MIN_BALANCE_CKB="${CELLFLOW_TESTNET_MIN_BALANCE_CKB:-250}"

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is required."
command -v npm >/dev/null 2>&1 || die "npm is required."
command -v python3 >/dev/null 2>&1 || die "python3 is required."

[[ -f "${ROOT_DIR}/package.json" ]] || die "Run this from the CellFlow repository root, or pass the repo path as argument 1."
cd "$ROOT_DIR"

if [[ ! -d "${ROOT_DIR}/node_modules/@ckb-ccc/core" ]]; then
  say "Installing project dependencies required for local wallet generation"
  npm install --no-audit --no-fund
fi

mkdir -p "$BACKUP_DIR"

if [[ -f "$ENV_FILE" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$ENV_FILE" "$BACKUP_DIR/.env.testnet.local.${stamp}.bak"
  chmod 600 "$BACKUP_DIR/.env.testnet.local.${stamp}.bak" || true
else
  if [[ -f "$ROOT_DIR/.env.testnet.example" ]]; then
    cp "$ROOT_DIR/.env.testnet.example" "$ENV_FILE"
  else
    touch "$ENV_FILE"
  fi
fi
chmod 600 "$ENV_FILE"

say "Generating two fresh CKB Testnet wallets locally"

ROOT_DIR="$ROOT_DIR" ENV_FILE="$ENV_FILE" ADDR_FILE="$ADDR_FILE" RPC_URL="$RPC_URL" node --input-type=module <<'NODE'
import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { ccc } from "@ckb-ccc/core";

const envPath = process.env.ENV_FILE;
const addrPath = process.env.ADDR_FILE;
const rpcUrl = process.env.RPC_URL;

function makeClient() {
  if (typeof ccc.ClientPublicTestnet?.open === "function") {
    const owner = ccc.ClientPublicTestnet.open({ urls: [rpcUrl] });
    return {
      client: owner.value,
      dispose: async () => {
        if (typeof owner.dispose === "function") {
          try { await owner.dispose(); } catch {}
        }
      },
    };
  }

  const client = new ccc.ClientPublicTestnet(rpcUrl);
  return {
    client,
    dispose: async () => {
      for (const method of ["dispose", "close", "disconnect"]) {
        if (typeof client?.[method] === "function") {
          try { await client[method](); } catch {}
          break;
        }
      }
    },
  };
}

async function createWallet(client) {
  for (;;) {
    const raw = randomBytes(32).toString("hex");
    if (!/^[0-9a-f]{64}$/.test(raw)) continue;
    try {
      const signer = new ccc.SignerCkbPrivateKey(client, raw);
      await signer.connect();
      const address = await signer.getRecommendedAddress();
      if (!address.startsWith("ckt1")) continue;
      return { privateKey: `0x${raw}`, address };
    } catch {
      // Extremely unlikely invalid scalar; generate another one.
    }
  }
}

function setSingleEnv(lines, key, value) {
  const prefix = `${key}=`;
  const filtered = lines.filter((line) => !line.trimStart().startsWith(prefix));
  filtered.push(`${key}=${value}`);
  return filtered;
}

const { client, dispose } = makeClient();
try {
  const walletA = await createWallet(client);
  const walletB = await createWallet(client);

  let text = "";
  try { text = await readFile(envPath, "utf8"); } catch {}
  let lines = text.split(/\r?\n/).filter((line, i, arr) => !(i === arr.length - 1 && line === ""));

  lines = setSingleEnv(lines, "CKB_TESTNET_PRIVATE_KEY_A", walletA.privateKey);
  lines = setSingleEnv(lines, "CKB_TESTNET_PRIVATE_KEY_B", walletB.privateKey);

  await writeFile(envPath, lines.join("\n").replace(/\n+$/, "") + "\n");
  await chmod(envPath, 0o600);

  const publicText = [
    "CellFlow fresh CKB Testnet wallets",
    "",
    `Wallet A: ${walletA.address}`,
    `Wallet B: ${walletB.address}`,
    "",
    "Paste ONLY these PUBLIC ckt1... addresses into the Nervos Pudge faucet.",
    "Never replace CKB_TESTNET_PRIVATE_KEY_A/B with these addresses.",
    "",
  ].join("\n");
  await writeFile(addrPath, publicText);

  console.log(`Wallet A: ${walletA.address}`);
  console.log(`Wallet B: ${walletB.address}`);
} finally {
  await dispose();
}
NODE

say "Validating private keys saved in .env.testnet.local without printing them"
ENV_FILE="$ENV_FILE" python3 <<'PY'
from pathlib import Path
import os, re, sys

p = Path(os.environ["ENV_FILE"])
vals = {}
for line in p.read_text().splitlines():
    if line.startswith("CKB_TESTNET_PRIVATE_KEY_A=") or line.startswith("CKB_TESTNET_PRIVATE_KEY_B="):
        k, v = line.split("=", 1)
        raw = v.strip()
        if raw.startswith("0x"):
            raw = raw[2:]
        vals[k] = raw

for key in ("CKB_TESTNET_PRIVATE_KEY_A", "CKB_TESTNET_PRIVATE_KEY_B"):
    raw = vals.get(key, "")
    ok = bool(re.fullmatch(r"[0-9a-fA-F]{64}", raw))
    print(f"{key}: length={len(raw)} valid_hex={ok}")
    if not ok:
        sys.exit(2)
PY

say "Public faucet addresses"
cat "$ADDR_FILE"
printf '\nFaucet: https://faucet.nervos.org/\n'
printf 'Claim at least %s Testnet CKB per wallet; 10,000 CKB per wallet is convenient.\n' "$MIN_BALANCE_CKB"
printf '\nIMPORTANT: paste ONLY each ckt1... address into the faucet. Do not paste the env variable name, private key, quotes, or a trailing backslash.\n'

verify_funding() {
  ENV_FILE="$ENV_FILE" RPC_URL="$RPC_URL" MIN_BALANCE_CKB="$MIN_BALANCE_CKB" node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
import { ccc } from "@ckb-ccc/core";

const text = await readFile(process.env.ENV_FILE, "utf8");
const env = {};
for (const line of text.split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith("#")) continue;
  const pos = line.indexOf("=");
  if (pos < 0) continue;
  env[line.slice(0, pos).trim()] = line.slice(pos + 1).trim().replace(/^['"]|['"]$/g, "");
}

function makeClient() {
  if (typeof ccc.ClientPublicTestnet?.open === "function") {
    const owner = ccc.ClientPublicTestnet.open({ urls: [process.env.RPC_URL] });
    return { client: owner.value, owner };
  }
  return { client: new ccc.ClientPublicTestnet(process.env.RPC_URL), owner: null };
}

const minimum = ccc.fixedPointFrom(process.env.MIN_BALANCE_CKB || "250");
const { client, owner } = makeClient();
let enough = true;
try {
  for (const label of ["A", "B"]) {
    const key = env[`CKB_TESTNET_PRIVATE_KEY_${label}`];
    if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error(`CKB_TESTNET_PRIVATE_KEY_${label} is invalid`);
    const signer = new ccc.SignerCkbPrivateKey(client, key.slice(2));
    await signer.connect();
    const address = await signer.getRecommendedAddress();
    const balance = await signer.getBalance();
    console.log(`Wallet ${label}: ${address}`);
    console.log(`  Balance: ${ccc.fixedPointToString(balance)} CKB`);
    if (balance < minimum) enough = false;
  }
} finally {
  if (typeof owner?.dispose === "function") {
    try { await owner.dispose(); } catch {}
  }
}
if (!enough) process.exit(3);
NODE
}

while true; do
  read -r -p $'\nAfter BOTH faucet claims are processed, press Enter to verify funding (Ctrl+C to stop)...'
  if verify_funding; then
    say "Both fresh Testnet wallets are funded and ready"
    break
  else
    status=$?
    if [[ "$status" -eq 3 ]]; then
      warn "At least one wallet is still below ${MIN_BALANCE_CKB} CKB. Wait for the faucet transaction to process, then press Enter again."
    else
      die "Wallet verification failed (exit $status)."
    fi
  fi
done

cat <<'TXT'

Wallet setup is complete.
For a clean reviewer evidence run:
  ./run_testnet_local_all.sh --fresh

For debugging/retrying the same evidence bundle:
  ./run_testnet_local_all.sh --resume
TXT
