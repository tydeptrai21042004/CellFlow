# CellFlow UI route separation — V0.3.1

## Goal

Keep four different trust surfaces separate so reviewers and operators cannot mistake simulated state for real project state.

| Route | Audience | Credentials | Chain writes | Purpose |
|---|---|---:|---:|---|
| `/` | public/reviewer | none | none | product boundary, architecture and integration story |
| `/console` | operator | project API key | API-controlled operations | live transaction operations, evidence and integrations |
| `/demo` | evaluator | none | none | deterministic local walkthrough |
| `/console/setup` | deployer/admin | bootstrap token | provisioning only | first project bootstrap; disable afterwards |

## Production UX rules

1. Never render demo lifecycle values in the operator console.
2. Never request project API keys on the demo route.
3. Never expose bootstrap controls in the normal operator workflow.
4. Keep project API keys in page memory only.
5. Label live/simulated surfaces explicitly.
6. Prefer operational hierarchy over marketing copy inside `/console`.

## Verification

`npm test` includes route-boundary regressions and passes 67 deterministic tests in this source tree. A clean dependency-resolved Next.js build still requires a network-enabled environment and a committed lockfile before release.
