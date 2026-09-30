import { createHmac } from "node:crypto";
import { authenticateBearer, CellFlowService } from "@cellflow/api";
import { CellFlowError } from "@cellflow/core";
import {
  CellFlowRepository,
  migrateDatabase,
  type ApiKeyScope,
  type ProjectRecord,
} from "@cellflow/db";

export const repository = new CellFlowRepository();
export const service = new CellFlowService(repository);

let automaticBootstrapPromise: Promise<void> | null = null;

function automaticBootstrapNetwork(): ProjectRecord["network"] {
  const configured = process.env.CKB_NETWORK?.trim().toLowerCase();
  if (!configured || configured === "testnet") return "testnet";
  if (configured === "mainnet") return "mainnet";
  if (configured === "devnet") return "devnet";
  throw new CellFlowError(
    "INTERNAL_ERROR",
    `Unsupported CKB_NETWORK for automatic bootstrap: ${configured}`,
    500,
  );
}

function automaticBootstrapAdminApiKey(): string {
  const configured = process.env.CELLFLOW_INITIAL_ADMIN_API_KEY?.trim();
  if (configured) return configured;

  const bootstrapToken = process.env.CELLFLOW_BOOTSTRAP_TOKEN?.trim();
  if (bootstrapToken && bootstrapToken.length >= 24) {
    const suffix = createHmac("sha256", bootstrapToken)
      .update("cellflow:auto-bootstrap:initial-admin:v1", "utf8")
      .digest("base64url");
    return `cf_live_${suffix}`;
  }

  throw new CellFlowError(
    "INTERNAL_ERROR",
    "Automatic bootstrap requires CELLFLOW_INITIAL_ADMIN_API_KEY or CELLFLOW_BOOTSTRAP_TOKEN",
    500,
  );
}

async function performAutomaticBootstrap(): Promise<void> {
  if (process.env.CELLFLOW_AUTO_BOOTSTRAP !== "true") return;

  // Safe to run from concurrent Vercel invocations: migrateDatabase() and
  // createInitialProject() each use PostgreSQL transaction-scoped advisory locks.
  await migrateDatabase();

  if (await repository.hasAnyProject()) return;

  const initialApiKey = automaticBootstrapAdminApiKey();

  try {
    await service.setupProject({
      name: process.env.CELLFLOW_INITIAL_PROJECT_NAME?.trim() || "CellFlow Production",
      network: automaticBootstrapNetwork(),
      initialApiKey,
    });
  } catch (error) {
    if (error instanceof CellFlowError && error.code === "SETUP_ALREADY_COMPLETE") return;
    throw error;
  }
}

export async function ensureAutomaticBootstrap(): Promise<void> {
  if (process.env.CELLFLOW_AUTO_BOOTSTRAP !== "true") return;

  if (!automaticBootstrapPromise) {
    automaticBootstrapPromise = performAutomaticBootstrap().catch((error) => {
      automaticBootstrapPromise = null;
      throw error;
    });
  }

  await automaticBootstrapPromise;
}

export async function projectFromRequest(request: Request, requiredScope: ApiKeyScope = "read") {
  return authenticateBearer(request.headers.get("authorization"), repository, requiredScope);
}

export async function readJson(request: Request): Promise<unknown> {
  const configured = Number(process.env.CELLFLOW_MAX_JSON_BODY_BYTES ?? "262144");
  const maxBytes = Number.isFinite(configured) ? Math.min(Math.max(configured, 1024), 2 * 1024 * 1024) : 262144;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new CellFlowError("REQUEST_TOO_LARGE", `JSON request body exceeds ${maxBytes} bytes`, 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new CellFlowError("REQUEST_TOO_LARGE", `JSON request body exceeds ${maxBytes} bytes`, 413);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new CellFlowError("INVALID_JSON", "Request body is not valid JSON", 400);
  }
}
