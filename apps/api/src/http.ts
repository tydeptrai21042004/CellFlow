import { randomUUID } from "node:crypto";
import { CellFlowError } from "@cellflow/core";
import { ZodError } from "zod";

function responseHeaders(requestId: string): HeadersInit {
  return {
    "cache-control": "no-store, max-age=0",
    "x-request-id": requestId,
  };
}

function logError(requestId: string, error: unknown): void {
  const entry: Record<string, unknown> = {
    level: "error",
    service: "cellflow",
    requestId,
    at: new Date().toISOString(),
  };
  if (error instanceof CellFlowError) {
    entry.code = error.code;
    entry.httpStatus = error.httpStatus;
    entry.message = error.message;
  } else if (error instanceof ZodError) {
    entry.code = "VALIDATION_ERROR";
    entry.httpStatus = 400;
    entry.issueCount = error.issues.length;
  } else if (error instanceof Error) {
    entry.code = "INTERNAL_ERROR";
    entry.httpStatus = 500;
    entry.message = error.message;
    entry.name = error.name;
  } else {
    entry.code = "INTERNAL_ERROR";
    entry.httpStatus = 500;
    entry.message = "Unknown error";
  }
  console.error(JSON.stringify(entry));
}

function requestIdFrom(request?: Request): string {
  const supplied = request?.headers.get("x-request-id")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return randomUUID();
}

export function errorResponse(error: unknown, request?: Request): Response {
  const requestId = requestIdFrom(request);
  logError(requestId, error);
  if (error instanceof CellFlowError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details ?? null, requestId } },
      { status: error.httpStatus, headers: responseHeaders(requestId) },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues, requestId } },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId } },
    { status: 500, headers: responseHeaders(requestId) },
  );
}
