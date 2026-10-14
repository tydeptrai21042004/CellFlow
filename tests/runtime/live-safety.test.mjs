import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreBroadcastEvidence } from '../../scripts/evidence/live-safety.mjs';
const sha = '1'.repeat(40);
const genesis = `0x${'2'.repeat(64)}`;
const data = () => ({
  readiness: { responseOk: true, status: 200, body: { ok: true, releaseSha: sha } },
  network: [
    { url: 'https://rpc-a.example/rpc', chain: 'ckb_testnet', genesisHash: genesis, ok: true },
    { url: 'https://rpc-b.example/rpc', chain: 'ckb_testnet', genesisHash: genesis, ok: true },
  ], expectedSha: sha, expectedGenesis: genesis, strict: true,
});
test('strict pre-broadcast guard passes matching release and independent genesis', () => {
  assert.equal(assertPreBroadcastEvidence(data()).verifiedHosts, 2);
});
test('strict guard denies absent SHA, mismatched SHA and unready response', () => {
  const a = data(); delete a.expectedSha;
  assert.throws(() => assertPreBroadcastEvidence(a), /EXPECTED_RELEASE_SHA/);
  const b = data(); b.expectedSha = '3'.repeat(40);
  assert.throws(() => assertPreBroadcastEvidence(b), /does not match/);
  const c = data(); c.readiness.body.ok = false;
  assert.throws(() => assertPreBroadcastEvidence(c), /readiness/);
});
test('strict guard denies wrong or inconsistent genesis', () => {
  const a = data(); a.network[1].genesisHash = `0x${'4'.repeat(64)}`;
  assert.throws(() => assertPreBroadcastEvidence(a), /disagree on genesis/);
  const b = data(); b.expectedGenesis = `0x${'5'.repeat(64)}`;
  assert.throws(() => assertPreBroadcastEvidence(b), /GENESIS_HASH mismatch/);
  const c = data(); c.expectedGenesis = '';
  assert.throws(() => assertPreBroadcastEvidence(c), /requires CKB_EXPECTED_GENESIS_HASH/);
});
test('strict guard denies duplicate hosts and insecure URLs', () => {
  const a = data(); a.network[1].url = 'https://rpc-a.example/other';
  assert.throws(() => assertPreBroadcastEvidence(a), /independent/);
  const b = data(); b.network[0].url = 'http://rpc-a.example/rpc';
  assert.throws(() => assertPreBroadcastEvidence(b), /HTTPS/);
  const c = data(); c.network[0].url = 'https://user:pass@rpc-a.example/rpc';
  assert.throws(() => assertPreBroadcastEvidence(c), /HTTPS/);
});
