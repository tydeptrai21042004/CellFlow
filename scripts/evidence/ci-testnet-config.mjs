#!/usr/bin/env node
// Side-effect-free, fail-closed CI configuration gate. This script NEVER signs
// or sends a transaction and NEVER prints wallet private keys or API keys.
import { pathToFileURL } from 'node:url';

const HEX_KEY = /^(?:0x)?[0-9a-f]{64}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const GENESIS = /^0x[0-9a-f]{64}$/i;
const publicDemoKeys = new Set([
  '21cc3b4e32a1e9afdd51f54510c816d38bb7be37d40056854a467f4d92ebd96e',
  '3fc54dc0e24080697472c447dc38557adb69fad0289d917fdbd4445c9653776b',
]);

function validUrl(value, label, problems) {
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || url.search) {
      problems.push(`${label} must be an HTTPS URL without username/password/query/fragment`);
      return null;
    }
    return url;
  } catch {
    problems.push(`${label} must be a valid HTTPS URL`);
    return null;
  }
}

export function validateCiTestnetConfig(env) {
  const problems = [];
  if (env.CELLFLOW_TESTNET_CI !== 'true') problems.push('CELLFLOW_TESTNET_CI=true is required');
  if (env.CELLFLOW_TESTNET_STRICT_WALLET_ISOLATION !== 'true') problems.push('Strict wallet isolation is required');
  if (env.CELLFLOW_TESTNET_REQUIRE_RBF !== 'true') problems.push('Strict RBF evidence is required');
  if (env.CKB_NETWORK !== 'testnet') problems.push('CKB_NETWORK must equal testnet');
  if (!SHA.test(env.CELLFLOW_EXPECTED_RELEASE_SHA ?? '')) problems.push('Set CELLFLOW_DEPLOYED_SHA to the full 40-character SHA of the running deployed backend');
  if (!GENESIS.test(env.CKB_EXPECTED_GENESIS_HASH ?? '')) problems.push('Set CKB_TESTNET_GENESIS_HASH to the 0x-prefixed 32-byte TESTNET genesis hash');
  const hashes = [];
  for (const label of ['A', 'B']) {
    const value = env[`CKB_TESTNET_PRIVATE_KEY_${label}`]?.trim() ?? '';
    if (!HEX_KEY.test(value)) problems.push(`CKB_TESTNET_PRIVATE_KEY_${label} must be a 32-byte hex private key in GitHub Environment secrets`);
    else {
      const normalized = value.replace(/^0x/i, '').toLowerCase();
      hashes.push(normalized);
      if (publicDemoKeys.has(normalized)) problems.push(`CKB_TESTNET_PRIVATE_KEY_${label} cannot be a built-in public demo signer`);
    }
  }
  if (hashes.length === 2 && hashes[0] === hashes[1]) problems.push('Use distinct isolated wallet keys A and B');
  // Hard-coded PUBLIC funding addresses are independent of the GitHub secrets.
  // The live suite also derives the addresses from the real signers and fails
  // before spending if either secret belongs to a different wallet.
  const publicAddresses = ['A', 'B'].map(label => {
    const address = env[`CELLFLOW_TESTNET_ADDRESS_${label}`]?.trim() ?? '';
    if (!/^ckt1[023456789acdefghjklmnpqrstuvwxyz]{93}$/.test(address)) {
      problems.push(`CELLFLOW_TESTNET_ADDRESS_${label} must be a 97-character CKB Testnet bech32m public address`);
    }
    return address;
  });
  if (publicAddresses[0] && publicAddresses[0] === publicAddresses[1]) problems.push('Testnet A and B funding addresses must differ');
  if (!/^cf_live_[A-Za-z0-9_-]{24,}$/.test(env.CELLFLOW_API_KEY ?? '')) problems.push('CELLFLOW_TESTNET_API_KEY must be a valid dedicated cf_live_ API key');
  const endpoint = validUrl(env.CELLFLOW_URL, 'CELLFLOW_URL', problems);
  const rpcValues = [env.CKB_RPC_URL, ...(env.CKB_RPC_FALLBACK_URLS ?? '').split(/[\s,]+/).filter(Boolean)];
  const rpcs = rpcValues.map((value, i) => validUrl(value, `RPC endpoint ${i + 1}`, problems));
  if (rpcs.length < 2 || new Set(rpcs.filter(Boolean).map(v => v.hostname.toLowerCase())).size < 2) {
    problems.push('At least two independent HTTPS Testnet RPC hosts are required');
  }
  return {
    ok: problems.length === 0,
    problems,
    // Public metadata only; never serialize private key, API key or their hashes.
    safe: {
      network: env.CKB_NETWORK ?? null,
      endpoint: endpoint?.origin ?? null,
      rpcHostnames: rpcs.filter(Boolean).map(v => v.hostname.toLowerCase()),
      expectedReleaseSha: SHA.test(env.CELLFLOW_EXPECTED_RELEASE_SHA ?? '') ? env.CELLFLOW_EXPECTED_RELEASE_SHA : null,
      expectedGenesisHash: GENESIS.test(env.CKB_EXPECTED_GENESIS_HASH ?? '') ? env.CKB_EXPECTED_GENESIS_HASH : null,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = validateCiTestnetConfig(process.env);
  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.ok) process.exitCode = 2;
}
