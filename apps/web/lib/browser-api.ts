export async function jsonRequest<T = Record<string, unknown>>(
  path: string,
  apiKey?: string,
  init: RequestInit = {},
): Promise<T> {
  // Credentials must never be sent to absolute, protocol-relative or non-API URLs.
  if (!path.startsWith("/api/") || path.startsWith("//")) {
    throw new Error("jsonRequest requires a same-origin /api/ path");
  }
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("x-request-id")) headers.set("x-request-id", requestId);
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  const timeout = AbortSignal.timeout(45_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(path, {
    ...init,
    signal,
    headers,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal.aborted) throw signal.reason;
    if (!response.ok || response.status === 204 || response.status === 205) body = {};
    else throw new Error(`API returned invalid JSON [request ${headers.get("x-request-id") ?? requestId}]`);
  }
  if (!response.ok) {
    const errorBody = body && typeof body === "object" && !Array.isArray(body) && "error" in body
      ? (body as { error?: { message?: string; requestId?: string } }).error
      : undefined;
    const message = typeof errorBody?.message === "string" ? errorBody.message : `HTTP ${response.status}`;
    const correlation = typeof errorBody?.requestId === "string"
      ? errorBody.requestId : response.headers.get("x-request-id") ?? headers.get("x-request-id") ?? requestId;
    throw new Error(`${message} [request ${correlation}]`);
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
