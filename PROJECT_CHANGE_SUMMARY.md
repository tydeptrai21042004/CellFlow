# CellFlow implementation change summary

This repository started as a Markdown-only project blueprint. The implemented V0.1 adds a runnable TypeScript monorepo while retaining the research/design documents.

## Implemented

- canonical core model with separate submission, chain and workflow state;
- confirmation-depth policy and explicit reorg handling;
- deterministic pre-broadcast CKB transaction identity through CCC;
- ambiguous-broadcast recovery without blind automatic rebroadcast;
- PostgreSQL migration/repository with project isolation, idempotent intents, optimistic concurrency and append-only state events;
- CKB JSON-RPC reconciliation and confirmation calculation;
- minimal expected output-Cell assertions in V1;
- signed per-endpoint webhooks with retry and SSRF/DNS-rebinding protections;
- Next.js dashboard and REST API;
- Vercel Workflow durable reconciliation plus repair cron;
- deterministic evidence export with SHA-256;
- OpenAPI contract and integration examples;
- CI/tree/state-machine tests.

## Deliberately not included in V0.1

Billing, Fiber/RGB++ integration, generalized multi-chain support, a complex assertion DSL, automatic replacement transactions, or custody of private signing material. Those are outside the narrow transaction-recovery boundary.
