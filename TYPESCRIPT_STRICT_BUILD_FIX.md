# Vercel TypeScript strict-build fix

This patch addresses the TypeScript errors surfaced after the Next.js/Turbopack compile completed successfully.

## Root causes

1. `exactOptionalPropertyTypes` rejected forwarding Zod optional fields as explicitly-present `undefined` values from `app/api/setup/route.ts`.
2. `postgres.js` `sql.json()` accepts its JSON value type, not arbitrary `unknown`, `Record<string, unknown>`, or domain interfaces without JSON index signatures.
3. Transaction callbacks receive `TransactionSql`, not the full connection-level `Sql`; casting transaction handles to `Sql` was both unnecessary and rejected by TypeScript.
4. `applySnapshot()` directly interpolated `unknown` JSON values from prior database state into a SQL template.

## Changes

- Setup route now conditionally spreads optional `rpcUrl` and `confirmationPolicy` only when defined.
- Added a `toJsonValue()` normalization boundary before values enter `sql.json()`.
- `insertEventAndOutbox()` now accepts `TransactionSql` directly.
- Removed `tx as Sql` transaction casts.
- Prior/current assertion and raw-observation values are always bound as JSON parameters when non-null.

## Validation

- Existing CellFlow test suite: 23/23 passing.
- Targeted strict TypeScript compile for `@cellflow/core` + `@cellflow/db` with Postgres-compatible transaction/JSON type constraints: passing.

The patch intentionally keeps `strict: true` and `exactOptionalPropertyTypes: true`.
