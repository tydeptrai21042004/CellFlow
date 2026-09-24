# Funding and Validation Strategy

## Principle

Funding should follow evidence. Do not lead with a large DAO request based only on architecture.

## Pre-funding evidence

Minimum evidence package:

- live Vercel deployment;
- npm-installable CCC client;
- SkillPass integration;
- one independent external pilot;
- failure/recovery test suite;
- machine-readable evidence export;
- public documentation;
- clear non-overlap statement versus CCC, Cellora, Spark Verify, Fiber Test Lab, and Myelin.

## Metrics to collect

- tracked operations;
- committed operations;
- unknown/reconciling operations;
- recovered operations after RPC errors;
- duplicate intent attempts safely collapsed;
- rejected/conflicted executions;
- median and p95 submit-to-commit observation time;
- number of integrated applications;
- webhook delivery success/retry counts;
- operator/manual intervention count.

## Spark-sized proposal

Keep the first funded milestone narrow:

- reusable core;
- Vercel reference service;
- CCC SDK;
- SkillPass pilot;
- failure evidence;
- documentation.

Do not bundle RGB++, Fiber, mobile, analytics, billing, or advanced Cell assertions.

## DAO follow-on

A later DAO proposal is justified only after external adoption. Possible expansion:

- expected Cell assertions;
- multiple RPC providers/failover;
- richer conflict diagnostics;
- self-hosting profiles;
- Cellora integration;
- dependency-chain visualization;
- more database adapters;
- stable API/SDK guarantees;
- security audit.

## Reviewer verification path

Every funding milestone should specify:

1. command to install;
2. command to run tests;
3. live URL;
4. expected output;
5. machine-readable evidence file;
6. exact Git commit/release tag;
7. independent pilot proof.

## Claims to avoid

Do not say:

- "exactly-once blockchain execution";
- "guaranteed production safety";
- "works with every CKB app";
- "replaces CCC/indexers/RPC providers";
- "production-ready" before external validation.

Use verifiable, bounded claims.
