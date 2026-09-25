# CellFlow V0.3 repository tree

```text
CellFlow/
├── package.json
├── tsconfig.base.json
├── .env.example
├── vercel.json
├── README.md
├── PRODUCTION_READINESS_V0.3.md
├── IMPLEMENTATION_STATUS.md
├── FUNDING_AND_VALIDATION.md
├── SECURITY.md
├── SECURITY_MODEL.md
├── VERCEL_DEPLOYMENT.md
├── apps/
│   ├── api/src/
│   │   ├── auth.ts
│   │   ├── http.ts
│   │   ├── schemas.ts
│   │   └── service.ts
│   └── web/
│       ├── app/
│       │   ├── page.tsx                 # public product overview
│       │   ├── console/page.tsx         # live operator console
│       │   ├── console/setup/page.tsx   # one-time bootstrap
│       │   ├── demo/page.tsx            # local-only walkthrough
│       │   └── api/
│       │   ├── health/
│       │   ├── ready/
│       │   ├── setup/
│       │   ├── internal/maintenance/
│       │   └── v1/
│       │       ├── intents/
│       │       ├── metrics/
│       │       ├── operations/
│       │       ├── project-evidence/
│       │       ├── webhooks/
│       │       └── api-keys/
│       ├── components/
│       │   ├── ProductHeader.tsx
│       │   ├── Dashboard.tsx
│       │   ├── IntegrationsPanel.tsx
│       │   ├── BootstrapProject.tsx
│       │   ├── ExampleUse.tsx
│       │   └── IntentDrawer.tsx
│       └── lib/
├── packages/
│   ├── core/src/
│   ├── ccc/src/
│   ├── cli/bin/cellflow.mjs
│   ├── db/
│   │   ├── migrations/001_init.sql
│   │   ├── migrations/002_v02_hardening.sql
│   │   ├── migrations/003_production_readiness.sql
│   │   └── src/
│   ├── assertions/src/
│   └── webhooks/src/
├── workflows/
│   ├── reconcile/src/
│   └── webhook-delivery/src/
├── docs/
│   ├── api/openapi.yaml
│   ├── operations/RUNBOOK.md
│   └── funding/REVIEWER_VERIFICATION.md
├── tests/runtime/
│   ├── core.test.mjs
│   ├── assertions.test.mjs
│   ├── hardening.test.mjs
│   ├── stability-upgrade.test.mjs
│   ├── production-readiness.test.mjs
│   ├── ui.test.mjs
│   └── tree.test.mjs
├── scripts/
│   ├── migrate.mjs
│   ├── release-preflight.mjs
│   └── verify-tree.mjs
└── .github/workflows/ci.yml
```
