import { CellFlowError } from "@cellflow/core";
import { ZodError } from "zod";

export function errorResponse(error: unknown): Response {
  if (error instanceof CellFlowError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details ?? null } },
      { status: error.httpStatus },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues } },
      { status: 400 },
    );
  }
  console.error("CellFlow API error", error);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 },
  );
}
