/** No network calls: pre-broadcast reviewer proof gate. */
const SHA = /^[0-9a-f]{40}$/i;
const GENESIS = /^0x[0-9a-f]{64}$/i;

export function assertPreBroadcastEvidence({ readiness, network, expectedSha, expectedGenesis, strict = false }) {
  const body = readiness?.body;
  if (readiness?.responseOk !== true || readiness?.status !== 200 || body?.ok !== true) {
    throw new Error("Refusing broadcast: hosted CellFlow readiness is not HTTP 200 with ok=true");
  }
  if (strict && !SHA.test(expectedSha ?? "")) {
    throw new Error("Strict Testnet run requires CELLFLOW_EXPECTED_RELEASE_SHA (full 40-character SHA)");
  }
  if (expectedSha && (!SHA.test(expectedSha) || String(body.releaseSha).toLowerCase() !== expectedSha.toLowerCase())) {
    throw new Error("Refusing broadcast: hosted release SHA does not match CELLFLOW_EXPECTED_RELEASE_SHA");
  }
  if (strict && !GENESIS.test(expectedGenesis ?? "")) {
    throw new Error("Strict Testnet run requires CKB_EXPECTED_GENESIS_HASH (full 0x-prefixed hash)");
  }
  if (!Array.isArray(network) || network.length < 2 || network.some(x => x?.ok !== true || x.chain !== "ckb_testnet" || !GENESIS.test(x.genesisHash ?? ""))) {
    throw new Error("Refusing broadcast: two healthy Testnet RPC observations are required");
  }
  const hosts = new Set();
  for (const item of network) {
    let url;
    try { url = new URL(item.url); } catch { throw new Error("Refusing broadcast: invalid RPC URL"); }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Refusing broadcast: Testnet RPC URLs must be HTTPS without embedded userinfo");
    }
    hosts.add(url.hostname.toLowerCase());
  }
  if (hosts.size < 2) throw new Error("Refusing broadcast: RPC endpoints are not independent hostnames");
  const genesis = network[0].genesisHash.toLowerCase();
  if (network.some(item => item.genesisHash.toLowerCase() !== genesis)) {
    throw new Error("Refusing broadcast: RPC endpoints disagree on genesis");
  }
  if (expectedGenesis && (!GENESIS.test(expectedGenesis) || expectedGenesis.toLowerCase() !== genesis)) {
    throw new Error("Refusing broadcast: CKB_EXPECTED_GENESIS_HASH mismatch");
  }
  return { releaseSha: body.releaseSha, genesisHash: genesis, verifiedHosts: hosts.size };
}
