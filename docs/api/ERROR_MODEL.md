# API Error Model

Use stable machine codes, e.g.:

- `AUTH_INVALID`
- `PROJECT_NOT_FOUND`
- `INTENT_CONFLICT`
- `INTENT_NOT_FOUND`
- `INVALID_TX_HASH`
- `INVALID_CURSOR`
- `INVALID_SIGNED_TRANSACTION`
- `RPC_UNAVAILABLE`
- `RPC_RESPONSE_INVALID`
- `TRANSITION_INVALID`
- `WEBHOOK_URL_INVALID`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

HTTP status is transport-level information; clients should branch on stable code when needed.

Never expose raw database errors or secrets.

Error responses include a correlation `requestId`; callers may also send a valid `X-Request-Id` (8–128 characters using letters, digits, `.`, `_`, `:`, or `-`) so client logs can be matched to CellFlow structured error logs.
