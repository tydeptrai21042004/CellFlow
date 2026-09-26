import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  CkbRpcClient,
  isBlockedRpcIp,
  parseRpcUrls,
} from "../../workflows/reconcile/src/rpc.ts";

process.env.NODE_ENV = "test";
process.env.CKB_ALLOW_INSECURE_RPC = "true";

const TARGET = `0x${"aa".repeat(32)}`;
const CREATOR = `0x${"bb".repeat(32)}`;
const GENESIS = `0x${"01".repeat(32)}`;
const CREATOR_BLOCK = `0x${"22".repeat(32)}`;
const LIVE_BLOCK = `0x${"33".repeat(32)}`;

function reply(response, id, result) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

async function startRpcServer({ mode = "mempool", failAll = false } = {}) {
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (failAll) {
        response.writeHead(503);
        response.end("unavailable");
        return;
      }
      const rpc = JSON.parse(body);
      const [first, , includePool] = rpc.params ?? [];
      switch (rpc.method) {
        case "get_blockchain_info":
          reply(response, rpc.id, { chain: "ckb_testnet", is_initial_block_download: false });
          break;
        case "get_block_hash":
          reply(response, rpc.id, first === "0x0" ? GENESIS : first === "0x20" ? CREATOR_BLOCK : null);
          break;
        case "get_tip_header":
          reply(response, rpc.id, { number: "0x30" });
          break;
        case "get_header":
          reply(response, rpc.id, first === CREATOR_BLOCK ? { number: "0x20" } : null);
          break;
        case "get_transaction":
          if (first === TARGET) {
            reply(response, rpc.id, null);
          } else if (first === CREATOR) {
            reply(response, rpc.id, {
              transaction: {
                outputs: [{ capacity: "0x174876e800", lock: { code_hash: `0x${"44".repeat(32)}`, hash_type: "type", args: "0x" } }],
                outputs_data: ["0x"],
              },
              tx_status: { status: "committed", block_hash: CREATOR_BLOCK },
            });
          } else {
            reply(response, rpc.id, null);
          }
          break;
        case "get_live_cell": {
          assert.equal(first.tx_hash, CREATOR);
          if (mode === "mempool") {
            reply(response, rpc.id, includePool
              ? { status: "unknown" }
              : { status: "live", block_hash: LIVE_BLOCK, cell: { output: { capacity: "0x174876e800", lock: { code_hash: `0x${"44".repeat(32)}`, hash_type: "type", args: "0x" } } } });
          } else {
            reply(response, rpc.id, { status: "unknown" });
          }
          break;
        }
        default:
          response.writeHead(500);
          response.end(`unsupported ${rpc.method}`);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/rpc`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("input inspection distinguishes mempool contention and records live-cell block evidence", async () => {
  const rpc = await startRpcServer({ mode: "mempool" });
  try {
    const client = new CkbRpcClient([rpc.url]);
    const observed = await client.observe(
      TARGET,
      undefined,
      { chain: "ckb_testnet", genesisHash: GENESIS },
      [{ txHash: CREATOR, index: 0 }],
    );
    assert.equal(observed.observation.status, "UNKNOWN");
    assert.equal(observed.inputInspection?.state, "MEMPOOL_CONTENDED");
    assert.equal(observed.inputInspection?.inputs[0]?.canonical, "LIVE");
    assert.equal(observed.inputInspection?.inputs[0]?.poolAware, "UNAVAILABLE");
    assert.equal(observed.inputInspection?.inputs[0]?.liveBlockHash, LIVE_BLOCK);
  } finally {
    await rpc.close();
  }
});

test("canonical spend requires creator transaction to remain canonical", async () => {
  const rpc = await startRpcServer({ mode: "spent" });
  try {
    const client = new CkbRpcClient([rpc.url]);
    const inspection = await client.inspectInputOutPoints(
      [{ txHash: CREATOR, index: 0 }],
      { chain: "ckb_testnet", genesisHash: GENESIS },
    );
    assert.equal(inspection.state, "CANONICALLY_SPENT");
    assert.equal(inspection.inputs[0]?.creatorTxStatus, "committed");
    assert.equal(inspection.inputs[0]?.creatorBlockHash, CREATOR_BLOCK);
  } finally {
    await rpc.close();
  }
});

test("RPC client fails over to the next configured endpoint", async () => {
  const bad = await startRpcServer({ failAll: true });
  const good = await startRpcServer({ mode: "mempool" });
  try {
    const client = new CkbRpcClient([bad.url, good.url]);
    const info = await client.getBlockchainInfo();
    assert.equal(info.chain, "ckb_testnet");
  } finally {
    await Promise.all([bad.close(), good.close()]);
  }
});

test("RPC destination policy blocks metadata/private addresses and credential-bearing URLs", () => {
  assert.equal(isBlockedRpcIp("169.254.169.254"), true);
  assert.equal(isBlockedRpcIp("10.1.2.3"), true);
  assert.equal(isBlockedRpcIp("8.8.8.8"), false);
  assert.deepEqual(parseRpcUrls("https://user:pass@example.com/rpc", "https://example.com/rpc"), ["https://example.com/rpc"]);
});
