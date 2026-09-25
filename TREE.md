# CellFlow V0.2 repository tree

```text
CellFlow/
├── package.json
├── tsconfig.base.json
├── .env.example
├── vercel.json
├── README.md
├── V0.2_HARDENING.md
├── IMPLEMENTATION_STATUS.md
├── PROJECT_SPEC.md
├── SECURITY_MODEL.md
├── VERCEL_DEPLOYMENT.md
├── apps/
│   ├── api/src/
│   │   ├── auth.ts
│   │   ├── http.ts
│   │   ├── schemas.ts
│   │   └── service.ts
│   └── web/
│       ├── app/api/
│       │   ├── health/
│       │   ├── setup/
│       │   ├── internal/maintenance/
│       │   └── v1/
│       │       ├── intents/
│       │       ├── webhooks/
│       │       └── api-keys/
│       ├── components/Dashboard.tsx
│       ├── lib/workflow.ts
│       └── workflows/reconcile-intent.ts
├── packages/
│   ├── core/src/
│   ├── ccc/src/
│   ├── cli/bin/cellflow.mjs
│   ├── db/
│   │   ├── migrations/001_init.sql
│   │   ├── migrations/002_v02_hardening.sql
│   │   └── src/
│   ├── assertions/src/
│   └── webhooks/src/
├── workflows/
│   ├── reconcile/src/
│   └── webhook-delivery/src/
├── tests/runtime/
│   ├── core.test.mjs
│   ├── assertions.test.mjs
│   ├── hardening.test.mjs
│   └── tree.test.mjs
├── scripts/
│   ├── migrate.mjs
│   └── verify-tree.mjs
└── .github/workflows/ci.yml
```
