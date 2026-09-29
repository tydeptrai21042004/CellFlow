# CellFlow CrowdCell reviewer patch

Base compared against: `CellFlow-main(20260929-153943).zip`.

This ZIP intentionally contains only files that differ from that base.
Copy/merge these files over the repository root, preserving paths.

## Modified existing files
- `apps/web/app/api/v1/intents/[intentId]/rejected/route.ts`
- `package.json`
- `packages/ccc/src/ccc.ts`
- `packages/core/src/state-machine.ts`
- `vercel.json`
- `workflows/reconcile/src/reconcile.ts`

## New files
- `docs/CROWDCELL_REVIEW_VALIDATION.md`
- `docs/VERCEL_REVIEW_AUTOMATION.md`
- `scripts/validate-crowdcell-review.sh`
- `tests/runtime/crowdcell-review-final.test.mjs`

## Main effects
- submit-time suspected input conflicts trigger reconciliation immediately;
- explicit CCC `inputRefs` can distinguish application/wallet inputs;
- strict CCC Transaction/TransactionLike TypeScript boundary fix;
- persisted configurable contention grace (`CELLFLOW_CONTENTION_GRACE_MS`, default 30000 ms);
- role-aware recovery after contention grace expiry;
- Vercel build runs deterministic reviewer checks before deployment;
- reviewer-focused regression validation command is added.

No files unique to the supplied base repository were deleted or replaced.
