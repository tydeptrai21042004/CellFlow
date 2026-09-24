import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CellFlowError } from "@cellflow/core";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function inV4Range(ip: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, prefix]) => inV4Range(ip, String(base), Number(prefix)));
  }
  if (family === 6) {
    const value = ip.toLowerCase();
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped && isIP(mapped) === 4) return isBlockedIp(mapped);
    return (
      value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8")
    );
  }
  return true;
}

export interface ValidatedWebhookDestination {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function validateWebhookDestination(
  rawUrl: string,
  options: { allowHttpLocalhost?: boolean } = {},
): Promise<ValidatedWebhookDestination> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CellFlowError("WEBHOOK_URL_INVALID", "Webhook URL is not valid", 400);
  }

  if (url.username || url.password) {
    throw new CellFlowError("WEBHOOK_URL_INVALID", "Webhook URL must not contain credentials", 400);
  }
  const isLocalDev = options.allowHttpLocalhost && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocalDev && url.protocol === "http:")) {
    throw new CellFlowError("WEBHOOK_URL_INVALID", "Webhook URL must use HTTPS", 400);
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new CellFlowError("WEBHOOK_URL_INVALID", "Webhook hostname did not resolve", 400);
  }
  if (!isLocalDev && records.some((record) => isBlockedIp(record.address))) {
    throw new CellFlowError("WEBHOOK_URL_INVALID", "Webhook hostname resolves to a blocked address", 400);
  }
  const chosen = records[0];
  if (!chosen || (chosen.family !== 4 && chosen.family !== 6)) {
    throw new CellFlowError("WEBHOOK_URL_INVALID", "Webhook hostname resolved to an unsupported address", 400);
  }
  return { url, address: chosen.address, family: chosen.family };
}

export async function validateWebhookUrl(
  rawUrl: string,
  options: { allowHttpLocalhost?: boolean } = {},
): Promise<URL> {
  return (await validateWebhookDestination(rawUrl, options)).url;
}
