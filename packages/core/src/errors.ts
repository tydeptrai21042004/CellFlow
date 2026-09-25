export type CellFlowErrorCode =
  | "AUTH_INVALID"
  | "AUTH_SCOPE_REQUIRED"
  | "API_KEY_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "INTENT_CONFLICT"
  | "INTENT_NOT_FOUND"
  | "INVALID_TX_HASH"
  | "INVALID_SIGNED_TRANSACTION"
  | "RPC_UNAVAILABLE"
  | "RPC_RESPONSE_INVALID"
  | "TRANSITION_INVALID"
  | "WEBHOOK_URL_INVALID"
  | "RATE_LIMITED"
  | "ASSERTION_FAILED"
  | "INVALID_JSON"
  | "INVALID_CURSOR"
  | "REQUEST_TOO_LARGE"
  | "WEBHOOK_NOT_FOUND"
  | "INTERNAL_ERROR";

export class CellFlowError extends Error {
  constructor(
    public readonly code: CellFlowErrorCode,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CellFlowError";
  }
}
