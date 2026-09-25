# Vercel TypeScript build fix

Vercel successfully completed the Turbopack compilation but Next.js stopped during its TypeScript dependency check with:

`Please install @types/node`

The monorepo root already declared `@types/node`, but the deployable Next.js workspace `apps/web` did not. The fix adds `@types/node` directly to `apps/web/devDependencies`, so the package is present in the package root Next.js validates on Vercel.

After applying this change, run `npm install` so npm can refresh `package-lock.json` in a network-enabled environment, then commit the lockfile.
