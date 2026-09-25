# CellFlow Security Policy

## Scope

CellFlow is a non-custodial operations/recovery layer. It must never receive wallet private keys, seed phrases, passkeys, or recovery material.

## Reporting

Please report suspected vulnerabilities privately to the repository maintainer before public disclosure. Include the affected endpoint/module, reproduction steps, expected impact, and whether the issue is exploitable across project boundaries.

Do not include real private keys or production secrets in a report.

## High-priority classes

The maintainers treat these as release-blocking:

- cross-project data access or API-key authorization bypass;
- SSRF/DNS-rebinding paths in webhook or RPC handling;
- duplicate transaction broadcast caused by recovery logic;
- state corruption caused by concurrent reconciliation/workflow execution;
- webhook signing-secret exposure;
- wrong-network RPC acceptance when network identity is configured/pinned;
- unbounded request/response/resource consumption;
- evidence export that silently disagrees with durable state.

## Production expectations

Before a public production release:

1. generate and commit `package-lock.json` in a network-enabled environment;
2. run CI with `npm ci`, tests, typecheck, and a production Next.js build;
3. use separate high-entropy bootstrap, cron, and encryption secrets;
4. disable the bootstrap route after project provisioning;
5. pin the expected CKB genesis hash and configure at least one independent RPC fallback;
6. run a real CKB testnet recovery/reorg/Cell-assertion exercise;
7. complete an external cross-tenant and SSRF review.
