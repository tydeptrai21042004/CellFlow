# `@cellflow/api`

Framework-independent service/auth/schema layer used by the Next.js route handlers. It validates external input with Zod, authenticates hashed project API keys, enforces intent idempotency/conflict behavior, applies the canonical core state machine, coordinates repository writes/reconciliation and creates deterministic evidence exports.

HTTP route handlers live in `apps/web/app/api`; the contract is documented in `docs/api/openapi.yaml`.
