import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyChainObservation,
  deriveOverallStatus,
  deriveRecommendedAction,
  initialSnapshot,
  isSettlementReady,
  updateSubmission,
} from '../../.tmp/core/index.js';
import {
  postSettlementMonitorMs,
  shouldContinueSettlementMonitoring,
  shouldReverifyExpectedCells,
} from '../../workflows/reconcile/src/monitoring.ts';

function confirmed(blocks = 4) {
  const initial = updateSubmission(initialSnapshot({ mode: 'depth', blocks }), 'SUBMITTED');
  return applyChainObservation(initial, {
    status: 'COMMITTED',
    observedAt: '2026-10-10T10:00:00.000Z',
    raw: {source: 'test'},
    blockHash: `0x${'ab'.repeat(32)}`,
    blockNumber: '0x64',
    tipBlockNumber: `0x${(99+blocks).toString(16)}`,
  }).snapshot;
}

test('chain CONFIRMED plus required assertion PENDING remains unsettled and recommends reconciliation', () => {
  const snapshot = confirmed();
  assert.equal(deriveOverallStatus(snapshot), 'CONFIRMED');
  assert.equal(isSettlementReady(snapshot, 'PENDING', 1), false);
  assert.equal(deriveRecommendedAction(snapshot, null, 'PENDING', null, null, 1), 'WAIT_FOR_RECONCILIATION');
});

test('RPC recovery PENDING -> VERIFIED is a unique false-to-true readiness transition', () => {
  const snapshot = confirmed();
  const observed = ['PENDING', 'VERIFIED', 'VERIFIED', 'VERIFIED'];
  let prior = false;
  let emitted = 0;
  for (const status of observed) {
    const next = isSettlementReady(snapshot, status, 1);
    if (next && !prior) emitted++;
    prior = next;
  }
  assert.equal(emitted, 1);
  assert.equal(deriveRecommendedAction(snapshot, null, 'VERIFIED', null, null, 1), 'NONE');
});

test('assertion failure is manual review; no premature success', () => {
  const snapshot = confirmed();
  assert.equal(isSettlementReady(snapshot, 'FAILED', 1), false);
  assert.equal(deriveRecommendedAction(snapshot, null, 'FAILED', null, null, 1), 'MANUAL_REVIEW');
});

test('absence of required cells is vacuously verified only with canonical commit evidence', () => {
  const snapshot = confirmed();
  assert.equal(isSettlementReady(snapshot, null, 0), true);
  assert.equal(isSettlementReady({...snapshot, committedBlockHash: undefined}, null, 0), false);
  assert.equal(isSettlementReady({...snapshot, confirmationCount: 3}, null, 0), false);
  assert.equal(isSettlementReady({...snapshot, chainStatus: 'PENDING'}, null, 0), false);
  assert.equal(isSettlementReady({...snapshot, workflowStatus: 'REORGED'}, null, 0), false);
  assert.equal(isSettlementReady({...snapshot, workflowStatus: 'CONFLICTED'}, null, 0), false);
  assert.equal(isSettlementReady({...snapshot, confirmationCount: 0}, null, -1), false);
});

test('canonical reorg after configured depth revokes settled predicate', () => {
  const snapshot = confirmed();
  assert.equal(isSettlementReady(snapshot, 'VERIFIED', 1), true);
  const reorg = applyChainObservation(snapshot, {
    status: 'PENDING',
    observedAt: '2026-10-10T10:15:00.000Z',
    raw: { fork: true },
    priorCommitCanonical: false,
  });
  assert.equal(reorg.reorgDetected, true);
  assert.equal(deriveOverallStatus(reorg.snapshot), 'REORGED');
  assert.equal(isSettlementReady(reorg.snapshot, 'VERIFIED', 1), false);
});

test('reconfirmation requires fresh assertions on new block', () => {
  const old = confirmed();
  const reIncluded = applyChainObservation(old, {
    status: 'COMMITTED',
    observedAt: '2026-10-10T10:15:00.000Z',
    raw: { fork: true },
    blockHash: `0x${'ef'.repeat(32)}`,
    blockNumber: '0x64',
    tipBlockNumber: '0x67',
    priorCommitCanonical: false,
  });
  assert.equal(reIncluded.reorgDetected, true);
  assert.equal(isSettlementReady(reIncluded.snapshot, 'PENDING', 1), false);
  assert.equal(isSettlementReady(reIncluded.snapshot, 'VERIFIED', 1), true);
});

test('finite monitoring is bounded by persisted first ready timestamp and expires', () => {
  const start = '2026-10-10T10:00:00.000Z';
  const startMs = Date.parse(start);
  assert.equal(shouldContinueSettlementMonitoring(true, start, startMs+59999, 60000), true);
  assert.equal(shouldContinueSettlementMonitoring(true, start, startMs+60000, 60000), false);
  assert.equal(shouldContinueSettlementMonitoring(false, start, startMs, 60000), false);
  assert.equal(shouldContinueSettlementMonitoring(true, null, startMs, 60000), false);
  assert.equal(shouldContinueSettlementMonitoring(true, 'invalid', startMs, 60000), false);
  assert.equal(shouldContinueSettlementMonitoring(true, start, startMs, 0), false);
});

test('monitoring configuration rejects invalid values and caps max window', () => {
  const prior = process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS;
  try {
    process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS = 'NaN';
    assert.equal(postSettlementMonitorMs(), 0);
    process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS = '-42';
    assert.equal(postSettlementMonitorMs(), 0);
    process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS = '3600000';
    assert.equal(postSettlementMonitorMs(), 3600000);
    process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS = '999999999';
    assert.equal(postSettlementMonitorMs(), 7*24*60*60_000);
  } finally {
    if (prior === undefined) delete process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS;
    else process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS = prior;
  }
});


test('post-settlement monitoring does not invalidate point-in-time live Cell proof just because Cell was later spent', () => {
  const same = {previouslySettled:true, previouslyVerified:true,
    priorCommittedBlockHash:'0xaaa', currentCommittedBlockHash:'0xaaa', reorgDetected:false};
  assert.equal(shouldReverifyExpectedCells(same), false);
  assert.equal(shouldReverifyExpectedCells({...same, reorgDetected:true}), true);
  assert.equal(shouldReverifyExpectedCells({...same, currentCommittedBlockHash:'0xbbb'}), true);
  assert.equal(shouldReverifyExpectedCells({...same, previouslySettled:false}), true);
  assert.equal(shouldReverifyExpectedCells({...same, previouslyVerified:false}), true);
});
