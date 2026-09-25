import { z } from "zod";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const scriptAssertion = z.object({
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  hashType: z.enum(["data", "type", "data1", "data2"]).optional(),
  args: hex.optional(),
}).refine((value) => Object.keys(value).length > 0, "Script assertion must check at least one field");

export const expectedCellSchema = z.object({
  outputIndex: z.number().int().min(0).max(1024),
  mode: z.enum(["created", "live"]).default("created"),
  capacity: hex.optional(),
  lock: scriptAssertion.optional(),
  type: scriptAssertion.nullable().optional(),
  data: hex.optional(),
}).refine(
  (value) => value.capacity !== undefined || value.lock !== undefined || value.type !== undefined || value.data !== undefined,
  "Expected Cell assertion must check at least one Cell field",
);

export const createIntentSchema = z.object({
  intentId: z.string().min(1).max(128),
  metadata: z.record(z.string(), z.unknown()).default({}),
  expectedCells: z.array(expectedCellSchema).max(32).default([]),
});

export const txHashSchema = z.object({ txHash: z.string() });

export const setupSchema = z.object({
  name: z.string().min(1).max(120),
  network: z.enum(["testnet", "mainnet", "devnet"]).default("testnet"),
  rpcUrl: z.string().url().optional(),
  confirmationPolicy: z.union([
    z.object({ mode: z.literal("committed") }),
    z.object({ mode: z.literal("depth"), blocks: z.number().int().min(1).max(10_000) }),
  ]).optional(),
});

export const webhookSchema = z.object({ url: z.string().url() });

export const apiKeyCreateSchema = z.object({
  label: z.string().min(1).max(80).default("rotated"),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1).max(3).default(["read", "write"]),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
});

export const operatorNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) });

export const webhookRetrySchema = z.object({ endpointId: z.string().uuid().optional() });
