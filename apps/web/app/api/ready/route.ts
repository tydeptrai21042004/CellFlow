import { authenticateBearer } from "@cellflow/api";
import { CkbRpcClient, parseRpcUrls } from "@cellflow/reconcile";
import { repository } from "../../../lib/server.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

function normalizedHash(value: string | undefined): string | null {
  if (!value) return null;
  const hash = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function expectedChainForNetwork(network: string | undefined): string | null {
  if (network === "mainnet") return "ckb";
  if (network === "testnet") return "ckb_testnet";
  return null;
}

async function canSeeDetails(request: Request, production: boolean): Promise<boolean> {
  if (!production) return true;
  try {
    await authenticateBearer(request.headers.get("authorization"), repository, "admin");
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const urls = parseRpcUrls(
    process.env.CKB_RPC_URL,
    process.env.CKB_RPC_FALLBACK_URL,
    process.env.CKB_RPC_FALLBACK_URLS,
  );
  const production = process.env.NODE_ENV === "production";
  const expectedGenesis = normalizedHash(process.env.CKB_EXPECTED_GENESIS_HASH);
  const expectedChain = expectedChainForNetwork(process.env.CKB_NETWORK);
  const allowInsecureRpc = process.env.CKB_ALLOW_INSECURE_RPC === "true";
  const insecureRpcCount = urls.filter((url) => url.startsWith("http:")).length;
  const checks = {
    database: false,
    rpc: false,
    rpcNetwork: expectedChain ? false : true,
    rpcGenesis: expectedGenesis ? false : true,
    rpcTransport: !production || allowInsecureRpc || insecureRpcCount === 0,
    encryptionKey: Boolean(process.env.CELLFLOW_ENCRYPTION_KEY && process.env.CELLFLOW_ENCRYPTION_KEY.length >= 32),
    cronSecret: Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 24),
    setupLocked: !production || process.env.CELLFLOW_SETUP_ENABLED !== "true",
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  let rpc: { endpoints: number; genesisHash?: string | null; chain?: string | null } = { endpoints: urls.length };

  try {
    checks.database = await repository.ping();
    if (!checks.database) errors.push("database unavailable");
  } catch {
    errors.push("database unavailable");
  }

  if (urls.length === 0) {
    errors.push("CKB RPC not configured");
  } else {
    try {
      const client = new CkbRpcClient(urls);
      const [, genesisHash, blockchainInfo] = await Promise.all([
        client.getTipHeader(),
        client.getGenesisHash(),
        client.getBlockchainInfo(),
      ]);
      checks.rpc = true;
      const chain = typeof blockchainInfo.chain === "string" ? blockchainInfo.chain : null;
      rpc = { endpoints: urls.length, genesisHash, chain };
      if (expectedChain) {
        checks.rpcNetwork = chain === expectedChain;
        if (!checks.rpcNetwork) errors.push(`CKB RPC network mismatch: expected ${expectedChain}`);
      }
      if (blockchainInfo.is_initial_block_download === true && production) {
        errors.push("CKB RPC is still in initial block download");
      }
      if (expectedGenesis) {
        checks.rpcGenesis = genesisHash?.toLowerCase() === expectedGenesis;
        if (!checks.rpcGenesis) errors.push("CKB RPC genesis hash does not match CKB_EXPECTED_GENESIS_HASH");
      } else if (production) {
        warnings.push("CKB_EXPECTED_GENESIS_HASH is not pinned; configure it to prevent accidental wrong-network RPC use");
      }
    } catch {
      errors.push("CKB RPC unavailable");
    }
  }

  if (production && urls.length < 2) warnings.push("only one CKB RPC endpoint configured; add an independent fallback for production");
  if (!checks.rpcTransport) errors.push("plain HTTP CKB RPC is blocked in production unless CKB_ALLOW_INSECURE_RPC=true");
  if (!checks.encryptionKey) errors.push("encryption key missing or too short");
  if (!checks.cronSecret) errors.push("cron secret missing or too short");
  if (!checks.setupLocked) errors.push("project bootstrap must be disabled after production provisioning");

  const ok = Object.values(checks).every(Boolean);
  const detailed = await canSeeDetails(request, production);
  const base = {
    ok,
    service: "cellflow",
    version: "0.3.0",
    releaseSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CELLFLOW_RELEASE_SHA ?? null,
  };
  return Response.json(
    detailed ? { ...base, checks, rpc, warnings, errors } : base,
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store, max-age=0" } },
  );
}
