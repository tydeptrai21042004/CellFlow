import { authenticateBearer, CellFlowService } from "@cellflow/api";
import { CellFlowRepository } from "@cellflow/db";

export const repository = new CellFlowRepository();
export const service = new CellFlowService(repository);

export async function projectFromRequest(request: Request) {
  return authenticateBearer(request.headers.get("authorization"), repository);
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}
