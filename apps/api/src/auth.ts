import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { CellFlowError } from "@cellflow/core";
import { CellFlowRepository, type ProjectRecord } from "@cellflow/db";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): { id: string; key: string; prefix: string; hash: string } {
  const key = `cf_live_${randomBytes(24).toString("base64url")}`;
  return {
    id: randomUUID(),
    key,
    prefix: key.slice(0, 16),
    hash: hashApiKey(key),
  };
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
  return project;
}

export function requireMasterSecret(value: string | null): void {
  const expected = process.env.CELLFLOW_MASTER_SECRET;
  if (!expected || expected.length < 32) {
    throw new CellFlowError("INTERNAL_ERROR", "Server master secret is not configured", 500);
  }
  const presented = value?.startsWith("Bearer ") ? value.slice(7) : "";
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new CellFlowError("AUTH_INVALID", "Invalid setup authorization", 401);
  }
}
