# CellFlow repository tree

```text
CellFlow/
├── package.json
├── tsconfig.base.json
├── .env.example
├── vercel.json
├── README.md
├── IMPLEMENTATION_STATUS.md
├── PROJECT_SPEC.md
├── SECURITY_MODEL.md
├── VERCEL_DEPLOYMENT.md
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── auth.ts
│   │       ├── http.ts
│   │       ├── schemas.ts
│   │       └── service.ts
│   └── web/
│       ├── app/
│       │   ├── api/
│       │   │   ├── health/
│       │   │   ├── setup/
│       │   │   ├── internal/maintenance/
│       │   │   └── v1/
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── components/Dashboard.tsx
│       ├── lib/
│       └── workflows/reconcile-intent.ts
├── packages/
│   ├── core/src/
│   ├── ccc/src/
│   ├── db/
│   │   ├── migrations/001_init.sql
│   │   └── src/
│   ├── assertions/src/
│   └── webhooks/src/
├── workflows/
│   ├── reconcile/src/
│   └── webhook-delivery/src/
├── tests/runtime/
├── scripts/
│   ├── migrate.mjs
│   └── verify-tree.mjs
└── .github/workflows/ci.yml
```
