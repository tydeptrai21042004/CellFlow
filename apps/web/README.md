# CellFlow web/API application

Next.js 16 application deployed on Vercel. It provides:

- project bootstrap and one-time API-key display;
- REST API route handlers;
- operator dashboard for tracking/reconciling intents;
- Vercel Workflow durable reconciliation;
- cron repair sweep and webhook delivery;
- health/RPC checks.

The UI never holds a CKB private key. CCC signing stays in the consuming application or wallet.
