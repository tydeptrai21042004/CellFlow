export async function jsonRequest<T = Record<string, unknown>>(
  path: string,
  apiKey?: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? (body as { error?: { message?: string } }).error?.message
      : undefined;
    throw new Error(message ?? `HTTP ${response.status}`);
  }
  return body as T;
}

export function shortHash(value: string | null | undefined, head = 10, tail = 8): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "Never";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - now) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds <= 0 ? "Just now" : `in ${absolute}s`;
  const minutes = Math.round(absolute / 60);
  if (minutes < 60) return seconds <= 0 ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return seconds <= 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return seconds <= 0 ? `${days}d ago` : `in ${days}d`;
}

export function explorerTxUrl(network: string | undefined, txHash: string): string {
  const host = network === "mainnet" ? "https://explorer.nervos.org" : "https://pudge.explorer.nervos.org";
  return `${host}/transaction/${txHash}`;
}
