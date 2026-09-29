# Vercel automation for the CrowdCell review

## What runs on every Vercel deployment

`vercel.json` uses `npm run ci:vercel` as the build command. A deployment is rejected if any of these fail:

1. TypeScript typecheck.
2. CrowdCell reviewer regressions.
3. Core state-machine tests.
4. Broadcast classifier tests.
5. Deterministic RPC behavior tests.
6. Next.js production build.

This is intentionally deterministic and does **not** broadcast a real Testnet transaction during ordinary builds.

## What should be run as a separate Testnet evidence job

The reviewer also asked about real submit-time conflicts, higher-fee displacement, the ~30-second contention window, and wallet-vs-application input recovery. Those can be headless, but they should run as an explicit evidence workflow using disposable Testnet-only accounts rather than during every production deploy.

Recommended boundary:

- Build/deploy gate: deterministic tests only.
- Vercel Workflow/admin-only trigger: real Testnet race and polling.
- JoyID/passkey approval: manual only when demonstrating wallet UX; not required for the headless protocol proof.

Do not put production/Mainnet keys in the evidence workflow. Use dedicated Testnet accounts with minimal funds and server-side encrypted environment variables.
