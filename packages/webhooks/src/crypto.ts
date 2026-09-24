import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function encryptionKey(masterSecret: string): Buffer {
  if (masterSecret.length < 32) {
    throw new Error("CELLFLOW_MASTER_SECRET must be at least 32 characters");
  }
  return createHash("sha256").update(masterSecret).digest();
}

export function encryptSecret(secret: string, masterSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(masterSecret), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(ciphertext: string, masterSecret: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivText, tagText, bodyText] = parts;
  if (!ivText || !tagText || !bodyText) throw new Error("Invalid encrypted secret format");
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const body = Buffer.from(bodyText, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(masterSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function signWebhook(rawBody: string, timestamp: number, secret: string): string {
  const canonical = `v1.${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifyWebhookSignature(input: {
  rawBody: string;
  timestamp: number;
  signatureHeader: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - input.timestamp) > tolerance) return false;
  const presented = input.signatureHeader.startsWith("v1=")
    ? input.signatureHeader.slice(3)
    : input.signatureHeader;
  const expected = signWebhook(input.rawBody, input.timestamp, input.secret);
  const a = Buffer.from(presented, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
