import assert from 'node:assert/strict';
import test from 'node:test';
import { submitPersistedReplacement } from '../../scripts/evidence/persisted-replacement.mjs';

const hash = '0x' + 'a'.repeat(64);
const candidate = {
  txHash: hash, signedPayloadHashSha256: 'b'.repeat(64),
  signed: { hash }, inputOutPoints: [{ txHash: '0x' + 'c'.repeat(64), index: 0 }],
  inputRefs: [],
};
function mockFlow(events) {
  return {
    async prepare(x) { events.push('persist'); assert.equal(x.attemptKind, 'RBF_REPLACEMENT'); assert.equal(x.parentAttemptId, 'previous'); assert.equal(x.txHash, hash); return { txHash: x.txHash }; },
    async markBroadcasting() { events.push('broadcasting'); },
    async markSubmitted() { events.push('submitted'); },
    async markNodeRejected() { events.push('rejected'); },
    async markAmbiguous() { events.push('ambiguous'); },
  };
}
const options = (flow, submit) => ({ flow, intentId: 'intent-1', candidate, parentAttemptId: 'previous', metadata: {}, expectedCells: [], submit });

test('higher fee replacement is persisted before RPC submit', async () => {
  const events = [];
  const result = await submitPersistedReplacement(options(mockFlow(events), async () => {events.push('rpc');return {accepted:true,returnedHash:hash};}));
  assert.deepEqual(events, ['persist','broadcasting','rpc','submitted']);
  assert.equal(result.persistedBeforeBroadcast, true);
});
test('failed persistence forbids RPC broadcast', async () => {
  const events=[]; const flow=mockFlow(events);flow.prepare=async()=>{events.push('persist-failed'); throw Error('db unavailable');};
  await assert.rejects(submitPersistedReplacement(options(flow,async()=>events.push('rpc'))), /db unavailable/);
  assert.deepEqual(events,['persist-failed']);
});
test('persistence/readback mismatch forbids RPC broadcast', async () => {
  const events=[]; const flow=mockFlow(events);flow.prepare=async()=>({txHash:'0x'+'d'.repeat(64)});
  await assert.rejects(submitPersistedReplacement(options(flow,async()=>events.push('rpc'))), /refusing broadcast/);
  assert.deepEqual(events,[]);
});
test('explicit node reject preserves recorded attempt for reconciliation', async () => {
  const events=[]; const flow=mockFlow(events);
  await submitPersistedReplacement(options(flow,async()=>{events.push('rpc');return {accepted:false,classification:{outcome:'NODE_REJECTED',evidence:{errorType:'NODE_REJECTED'}}};}));
  assert.deepEqual(events,['persist','broadcasting','rpc','rejected']);
});
test('unknown response leaves the persisted replacement ambiguous, never resends', async () => {
  const events=[]; const flow=mockFlow(events);
  await submitPersistedReplacement(options(flow,async()=>{events.push('rpc');return {accepted:false,errorMessage:'timeout'};}));
  assert.deepEqual(events,['persist','broadcasting','rpc','ambiguous']);
});
test('RPC transport throws after persisted candidate: record ambiguity and rethrow', async () => {
  const events=[]; const flow=mockFlow(events);
  await assert.rejects(submitPersistedReplacement(options(flow,async()=>{events.push('rpc');throw Error('connection reset');})), /connection reset/);
  assert.deepEqual(events,['persist','broadcasting','rpc','ambiguous']);
});
test('mismatched node transaction hash fails closed and records ambiguity', async () => {
  const events=[];const flow=mockFlow(events);
  await assert.rejects(submitPersistedReplacement(options(flow,async()=>({accepted:true,returnedHash:'0x'+'f'.repeat(64)}))),/hash mismatch/);
  assert.deepEqual(events,['persist','broadcasting','ambiguous']);
});
test('submitted bookkeeping failure does not cause automatic replacement resend', async () => {
  const events=[];const flow=mockFlow(events);flow.markSubmitted=async()=>{events.push('submitted-failed');throw Error('database failed after acceptance');};
  await assert.rejects(submitPersistedReplacement(options(flow,async()=>{events.push('rpc');return {accepted:true,returnedHash:hash};})), /database failed/);
  assert.deepEqual(events,['persist','broadcasting','rpc','submitted-failed']);
});
