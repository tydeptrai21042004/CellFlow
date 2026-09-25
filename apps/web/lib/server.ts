import { authenticateBearer, CellFlowService } from "@cellflow/api";
import { CellFlowError } from "@cellflow/core";
import { CellFlowRepository } from "@cellflow/db";

export const repository = new CellFlowRepository();
export const service = new CellFlowService(repository);

export async function projectFromRequest(request: Request) {
  return authenticateBearer(request.headers.get("authorization"), repository);
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
