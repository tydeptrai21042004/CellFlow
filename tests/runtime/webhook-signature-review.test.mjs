import test from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook, verifyWebhookSignature } from '../../packages/webhooks/src/crypto.ts';

test('valid signed webhook is accepted within its configured replay window', () => {
  const secret = 'long-test-secret';
  const timestamp = 1_790_000_000;
  const rawBody = JSON.stringify({ id: 'same-event', type: 'intent.settlement_ready' });
  const signatureHeader = `v1=${signWebhook(rawBody, timestamp, secret)}`;
  const verify = (overrides = {}) => verifyWebhookSignature({ rawBody, timestamp, signatureHeader, secret, now: timestamp + 299, ...overrides });
  assert.equal(verify(), true);
  assert.equal(verify({ now: timestamp + 301 }), false);
  assert.equal(verify({ rawBody: `${rawBody} ` }), false);
  assert.equal(verify({ secret: 'wrong-secret' }), false);
  assert.equal(verify({ timestamp: 1.5 }), false);
  assert.equal(verify({ toleranceSeconds: -1 }), false);
  assert.equal(verify({ toleranceSeconds: 24 * 3600 }), false);
});

test('malformed or appended hex is always rejected, never silently truncated by Buffer.from', () => {
  const secret = 'long-test-secret';
  const timestamp = 1_790_000_000;
  const rawBody = '{}';
  const valid = signWebhook(rawBody, timestamp, secret);
  for (const signatureHeader of [`v1=${valid}garbage`, `v1=${valid}!`, `v1=${valid.slice(1)}`, 'v1=not_hex', '']) {
    assert.equal(verifyWebhookSignature({ rawBody, timestamp, signatureHeader, secret, now: timestamp }), false, signatureHeader);
  }
});
