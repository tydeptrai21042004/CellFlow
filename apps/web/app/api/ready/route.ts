import { authenticateBearer } from "@cellflow/api";
import { latestMigrationVersion } from "@cellflow/db";
import { CkbRpcClient, parseRpcUrls } from "@cellflow/reconcile";
import { ensureAutomaticBootstrap, repository } from "../../../lib/server.ts";

export const runtime = "nodejs";
export const maxDuration = 15;

function normalizedHash(value: string | undefined): string | null {
  if (!value) return null;
  const hash = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(hash) ? hash : null;
}


function publicReadinessStatus(checks: {
  database: boolean;
  schema: boolean;
  rpc: boolean;
  rpcNetwork: boolean;
  rpcGenesis: boolean;
  rpcTransport: boolean;
  encryptionKey: boolean;
  cronSecret: boolean;
  setupLocked: boolean;
}) {
  if (!checks.database) {
    return { code: "DATABASE_UNAVAILABLE", message: "Database is unavailable.", action: "Check DATABASE_URL and Neon availability." };
  }
  if (!checks.schema) {
    return { code: "INITIAL_SETUP_REQUIRED", message: "CellFlow schema is not initialized yet.", action: "Open /console/setup and run the one-time initialization." };
  }
  if (!checks.setupLocked) {
    return { code: "BOOTSTRAP_REQUIRED", message: "Initial project bootstrap has not completed.", action: "Open /console/setup and create the first project." };
  }
  if (!checks.rpc) {
    return { code: "RPC_UNAVAILABLE", message: "One or more configured CKB RPC checks failed.", action: "Check the configured CKB RPC endpoints." };
  }
  if (!checks.rpcNetwork) {
    return { code: "RPC_NETWORK_MISMATCH", message: "The CKB RPC network does not match CKB_NETWORK.", action: "Check CKB_NETWORK and RPC configuration." };
  }
  if (!checks.rpcGenesis) {
    return { code: "RPC_GENESIS_MISMATCH", message: "The CKB RPC genesis hash does not match the pinned value.", action: "Check CKB_EXPECTED_GENESIS_HASH and RPC configuration." };
  }
  if (!checks.rpcTransport) {
    return { code: "RPC_TRANSPORT_INSECURE", message: "Production readiness rejected an insecure CKB RPC transport.", action: "Use HTTPS RPC or explicitly allow insecure RPC for this deployment." };
  }
  if (!checks.encryptionKey || !checks.cronSecret) {
    return { code: "SERVER_CONFIGURATION_INCOMPLETE", message: "Required production server secrets are missing or too short.", action: "Check CELLFLOW_ENCRYPTION_KEY and CRON_SECRET in Vercel." };
  }
  return { code: "READY", message: "All production readiness checks passed.", action: null };
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
  let automaticBootstrapError: string | null = null;
  try {
    await ensureAutomaticBootstrap();
  } catch (error) {
    automaticBootstrapError = error instanceof Error ? error.message : "Automatic bootstrap failed";
    console.error("CellFlow automatic bootstrap failed", error);
  }

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
    schema: false,
    rpc: false,
    rpcNetwork: expectedChain ? false : true,
    rpcGenesis: expectedGenesis ? false : true,
    rpcTransport: !production || allowInsecureRpc || insecureRpcCount === 0,
    encryptionKey: Boolean(process.env.CELLFLOW_ENCRYPTION_KEY && process.env.CELLFLOW_ENCRYPTION_KEY.length >= 32),
    cronSecret: Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 24),
    setupLocked: !production,
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  if (automaticBootstrapError) errors.push(`automatic bootstrap failed: ${automaticBootstrapError}`);
  const endpointResults: Array<{
    endpoint: string;
    ok: boolean;
    chain: string | null;
    genesisHash: string | null;
    initialBlockDownload: boolean | null;
    error?: string;
  }> = [];

  try {
    checks.database = await repository.ping();
    if (!checks.database) errors.push("database unavailable");
    checks.schema = Boolean(checks.database && latestMigrationVersion && await repository.hasMigration(latestMigrationVersion));
    if (checks.database && !checks.schema) {
      errors.push(`database schema is not at ${latestMigrationVersion ?? "the latest migration"}`);
    }
    checks.setupLocked = !production || (checks.schema && await repository.hasAnyProject());
  } catch {
    errors.push("database unavailable");
  }

  if (urls.length === 0) {
    errors.push("CKB RPC not configured");
  } else {
    for (const url of urls) {
      try {
        const client = new CkbRpcClient([url]);
        const [, genesisHash, blockchainInfo] = await Promise.all([
          client.getTipHeader(),
          client.getGenesisHash(),
          client.getBlockchainInfo(),
        ]);
        const chain = typeof blockchainInfo.chain === "string" ? blockchainInfo.chain : null;
        const initialBlockDownload = blockchainInfo.is_initial_block_download === true;
        const networkOk = !expectedChain || chain === expectedChain;
        const genesisOk = !expectedGenesis || genesisHash?.toLowerCase() === expectedGenesis;
        const endpointOk = networkOk && genesisOk && (!production || !initialBlockDownload);
        endpointResults.push({ endpoint: url, ok: endpointOk, chain, genesisHash, initialBlockDownload });
        if (!networkOk) errors.push(`CKB RPC network mismatch for ${new URL(url).host}: expected ${expectedChain}`);
        if (!genesisOk) errors.push(`CKB RPC genesis mismatch for ${new URL(url).host}`);
        if (initialBlockDownload && production) errors.push(`CKB RPC ${new URL(url).host} is still in initial block download`);
      } catch (error) {
        endpointResults.push({
          endpoint: url,
          ok: false,
          chain: null,
          genesisHash: null,
          initialBlockDownload: null,
          error: error instanceof Error ? error.message : "RPC check failed",
        });
        errors.push(`CKB RPC unavailable: ${new URL(url).host}`);
      }
    }

    checks.rpc = endpointResults.length > 0 && endpointResults.every((item) => item.ok);
    checks.rpcNetwork = !expectedChain || endpointResults.every((item) => item.chain === expectedChain);
    checks.rpcGenesis = !expectedGenesis || endpointResults.every((item) => item.genesisHash?.toLowerCase() === expectedGenesis);
  }

  if (production && urls.length < 2) warnings.push("only one CKB RPC endpoint configured; add an independent fallback for production");
  if (production && !expectedGenesis) warnings.push("CKB_EXPECTED_GENESIS_HASH is not pinned; configure it to prevent accidental wrong-network RPC use");
  if (!checks.rpcTransport) errors.push("plain HTTP CKB RPC is blocked in production unless CKB_ALLOW_INSECURE_RPC=true");
  if (!checks.encryptionKey) errors.push("encryption key missing or too short");
  if (!checks.cronSecret) errors.push("cron secret missing or too short");
  if (!checks.setupLocked) errors.push("initial project bootstrap has not completed; create the first project through /console/setup");

  const ok = Object.values(checks).every(Boolean);
  const status = publicReadinessStatus(checks);
  const detailed = await canSeeDetails(request, production);
  const rpc = { endpoints: endpointResults };
  const base = {
    ok,
    service: "cellflow",
    version: "0.3.0",
    releaseSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CELLFLOW_RELEASE_SHA ?? null,
    status,
  };
  return Response.json(
    detailed ? { ...base, checks, rpc, warnings, errors } : base,
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store, max-age=0" } },
  );
}
