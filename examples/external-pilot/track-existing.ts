import { createCellFlow } from "@cellflow/ccc";

const flow = createCellFlow({
  endpoint: process.env.CELLFLOW_URL!,
  apiKey: process.env.CELLFLOW_API_KEY!,
});

const intentId = `pilot:${crypto.randomUUID()}`;
await flow.track({
  intentId,
  txHash: process.env.CKB_TX_HASH!,
  metadata: { source: "external-pilot" },
});

console.log(await flow.wait(intentId, { until: "confirmed" }));
