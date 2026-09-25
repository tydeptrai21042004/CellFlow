# Vercel / Turbopack build fix

The V0.2 source packages are consumed directly by the Next.js app. Turbopack therefore needs relative TypeScript source specifiers to resolve to actual source files rather than future emitted JavaScript files.

## Fix

- Relative TypeScript imports/exports inside the monorepo use explicit `.ts`/`.tsx` source extensions.
- `tsconfig.base.json` enables `allowImportingTsExtensions` and `rewriteRelativeImportExtensions`.
- Standalone `tsc` emission therefore rewrites local `.ts` references to `.js`, while Next/Turbopack resolves the source files directly.

This fixes cascaded errors such as:

- `Can't resolve './auth.js'`
- `Can't resolve './client.js'`
- `Can't resolve './rpc.js'`
- follow-on `Export ... doesn't exist in target module`

The npm audit/install-script warnings shown before the build are separate from this module-resolution failure.
