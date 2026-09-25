import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { CellFlowError } from "@cellflow/core";
import { CellFlowRepository, type ProjectRecord } from "@cellflow/db";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): { id: string; key: string; prefix: string; hash: string } {
  const key = `cf_live_${randomBytes(24).toString("base64url")}`;
  return { id: randomUUID(), key, prefix: key.slice(0, 16), hash: hashApiKey(key) };
}

export async function authenticateBearer(
  authorization: string | null,
  repository = new CellFlowRepository(),
): Promise<ProjectRecord> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new CellFlowError("AUTH_INVALID", "Missing Bearer API key", 401);
  }
  const key = authorization.slice(7).trim();
  if (key.length < 20) throw new CellFlowError("AUTH_INVALID", "Invalid API key", 401);
  const project = await repository.findProjectByApiKeyHash(hashApiKey(key));
  if (!project) throw new CellFlowError("AUTH_INVALID", "Invalid or revoked API key", 401);

  const limit = Number(process.env.CELLFLOW_RATE_LIMIT_PER_MINUTE ?? "240");
  const allowed = await repository.consumeRateLimit(project.id, "api", Number.isFinite(limit) ? limit : 240, 60);
  if (!allowed) throw new CellFlowError("RATE_LIMITED", "Project API rate limit exceeded", 429);
  return project;
}

export function requireBootstrapToken(value: string | null): void {
  if (process.env.NODE_ENV === "production" && process.env.CELLFLOW_SETUP_ENABLED !== "true") {
    throw new CellFlowError("AUTH_INVALID", "Project bootstrap endpoint is disabled", 403);
  }
  const expected = process.env.CELLFLOW_BOOTSTRAP_TOKEN;
  if (!expected || expected.length < 24) {
    throw new CellFlowError("INTERNAL_ERROR", "Server bootstrap token is not configured", 500);
  }
  const presented = value?.startsWith("Bearer ") ? value.slice(7) : "";
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new CellFlowError("AUTH_INVALID", "Invalid bootstrap authorization", 401);
  }
}

/** @deprecated V0.2 separates the bootstrap token from the encryption key. */
export const requireMasterSecret = requireBootstrapToken;
