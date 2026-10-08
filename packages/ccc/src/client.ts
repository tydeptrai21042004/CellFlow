import type {
  AttemptKind,
  ConflictType,
  InputRef,
  OutPointRef,
  SubmissionErrorType,
  SubmissionFailureEvidence,
} from "@cellflow/core";

export interface CellFlowClientOptions {
  endpoint: string;
  apiKey: string;
  /** Retry only transport-level fetch failures. Valid HTTP/API responses are never retried here. */
  transportRetryAttempts?: number;
  transportRetryDelayMs?: number;
  requestTimeoutMs?: number;
}

export interface TrackInput {
  intentId: string;
  txHash: string;
  metadata?: Record<string, unknown>;
  expectedCells?: unknown[];
}

export interface PrepareInput extends TrackInput {
  signedPayloadHashSha256?: string;
  /** Explicitly allow a new witness/signature payload for the same raw CKB tx hash. */
  allowSignedPayloadRevision?: boolean;
  inputOutPoints?: OutPointRef[];
  inputRefs?: InputRef[];
  attemptKind?: AttemptKind;
  parentAttemptId?: string | null;
}

export interface IntentView {
  intentId: string;
  txHash: string | null;
  inputOutPoints: OutPointRef[];
  inputRefs?: InputRef[];
  activeAttemptId?: string | null;
  winningAttemptId?: string | null;
  attempts?: unknown[];
  status: string;
  submissionStatus: string;
  chainStatus: string;
  workflowStatus: string;
  confirmationCount: number;
  assertionStatus: string | null;
  submissionErrorCode: string | null;
  submissionErrorType: SubmissionErrorType | null;
  submissionErrorDetails: unknown;
  conflictType: ConflictType | null;
  conflictDetails: unknown;
  recommendedAction: string;
  [key: string]: unknown;
}

export class CellFlowHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CellFlowHttpError";
  }
}

/** Keep untrusted client options finite and bounded (NaN would otherwise disable retries/timeouts). */
function boundedMilliseconds(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.trunc(value)))
    : fallback;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Request cancelled", "AbortError");
}

function delayUnlessAborted(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class CellFlowClient {
  readonly endpoint: string;

  constructor(private readonly options: CellFlowClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const attempts = Math.max(1, boundedMilliseconds(this.options.transportRetryAttempts, 1, 6));
    const retryDelayMs = boundedMilliseconds(this.options.transportRetryDelayMs, 500, 15_000);
    // Finite default prevents permanently hung UI/CLI requests; 0 explicitly disables the timeout.
    const requestTimeoutMs = boundedMilliseconds(this.options.requestTimeoutMs, 30_000, 300_000);
    let lastTransportError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (init.signal?.aborted) throw abortReason(init.signal);
      const timeout = requestTimeoutMs > 0 ? AbortSignal.timeout(requestTimeoutMs) : null;
      const activeSignal = init.signal && timeout
        ? AbortSignal.any([init.signal, timeout])
        : init.signal ?? timeout;
      const headers = new Headers(init.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      // The configured credential cannot be silently overridden by an arbitrary HeadersInit form.
      headers.set("authorization", `Bearer ${this.options.apiKey}`);

      try {
        const response = await fetch(`${this.endpoint}${path}`, {
          ...init,
          signal: activeSignal ?? null,
          headers,
        });
        // A received HTTP response is authoritative, including malformed successful JSON.
        // Invalid JSON must not trigger a replay of an operation that the server may have applied.
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (activeSignal?.aborted) throw abortReason(activeSignal);
          if (!response.ok) payload = {};
          else if (response.status === 204 || response.status === 205) payload = {};
          else throw new CellFlowHttpError(502, "INVALID_RESPONSE", "CellFlow returned invalid JSON");
        }
        if (!response.ok) {
          const body = payload && typeof payload === "object" && !Array.isArray(payload)
            ? payload as Record<string, unknown> : {};
          const rawError = body.error;
          const details = rawError && typeof rawError === "object" && !Array.isArray(rawError)
            ? rawError as Record<string, unknown> : {};
          throw new CellFlowHttpError(
            response.status,
            typeof details.code === "string" ? details.code : "HTTP_ERROR",
            typeof details.message === "string" ? details.message : `CellFlow request failed: HTTP ${response.status}`,
          );
        }
        return payload as T;
      } catch (error) {
        if (error instanceof CellFlowHttpError || activeSignal?.aborted) throw error;
        lastTransportError = error;
        if (attempt >= attempts) break;
        // A caller cancellation also interrupts the retry backoff.
        await delayUnlessAborted(Math.min(30_000, retryDelayMs * attempt), init.signal);
      }
    }

    throw lastTransportError instanceof Error
      ? lastTransportError
      : new Error(`CellFlow transport failed for ${path}`);
  }

  async track(input: TrackInput): Promise<IntentView> {
    const created = await this.request<{ intent: IntentView }>("/api/v1/intents", {
      method: "POST",
      body: JSON.stringify({
        intentId: input.intentId,
        metadata: input.metadata ?? {},
        expectedCells: input.expectedCells ?? [],
      }),
    });
    await this.request(`/api/v1/intents/${encodeURIComponent(input.intentId)}/track`, {
      method: "POST",
      body: JSON.stringify({ txHash: input.txHash }),
    });
    return (await this.get(input.intentId)) ?? created.intent;
  }

  async prepare(input: PrepareInput): Promise<IntentView> {
    await this.request<{ intent: IntentView }>("/api/v1/intents", {
      method: "POST",
      body: JSON.stringify({
        intentId: input.intentId,
        metadata: input.metadata ?? {},
        expectedCells: input.expectedCells ?? [],
      }),
    });
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(input.intentId)}/prepare`,
      {
        method: "POST",
        body: JSON.stringify({
          txHash: input.txHash,
          ...(input.signedPayloadHashSha256 ? { signedPayloadHashSha256: input.signedPayloadHashSha256 } : {}),
          ...(input.allowSignedPayloadRevision === true ? { allowSignedPayloadRevision: true } : {}),
          inputOutPoints: input.inputOutPoints ?? [],
          inputRefs: input.inputRefs ?? [],
          ...(input.attemptKind ? { attemptKind: input.attemptKind } : {}),
          ...(input.parentAttemptId !== undefined ? { parentAttemptId: input.parentAttemptId } : {}),
        }),
      },
    );
    return result.intent;
  }

  async preflight(intentId: string): Promise<IntentView> {
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(intentId)}/preflight`,
      { method: "POST", body: "{}" },
    );
    return result.intent;
  }

  async markBroadcasting(intentId: string): Promise<IntentView> {
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(intentId)}/broadcasting`,
      { method: "POST", body: "{}" },
    );
    return result.intent;
  }

  async markSubmitted(intentId: string): Promise<IntentView> {
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(intentId)}/submitted`,
      { method: "POST", body: "{}" },
    );
    return result.intent;
  }

  async markAmbiguous(
    intentId: string,
    failure?: SubmissionFailureEvidence,
  ): Promise<IntentView> {
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(intentId)}/ambiguous`,
      { method: "POST", body: JSON.stringify(failure ?? {}) },
    );
    return result.intent;
  }

  async markNodeRejected(
    intentId: string,
    failure: SubmissionFailureEvidence,
  ): Promise<IntentView> {
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(intentId)}/rejected`,
      { method: "POST", body: JSON.stringify(failure) },
    );
    return result.intent;
  }

  async reconcile(intentId: string): Promise<IntentView> {
    await this.request(`/api/v1/intents/${encodeURIComponent(intentId)}/reconcile`, {
      method: "POST",
      body: "{}",
    });
    const current = await this.get(intentId);
    if (!current) throw new Error("Intent disappeared after reconciliation");
    return current;
  }

  async get(intentId: string, init: RequestInit = {}): Promise<IntentView | null> {
    try {
      const result = await this.request<{ intent: IntentView }>(
        `/api/v1/intents/${encodeURIComponent(intentId)}`,
        init,
      );
      return result.intent;
    } catch (error) {
      if (error instanceof CellFlowHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async wait(
    intentId: string,
    options: { timeoutMs?: number; intervalMs?: number; until?: "committed" | "confirmed" | "verified"; signal?: AbortSignal } = {},
  ): Promise<IntentView> {
    const timeoutMs = boundedMilliseconds(options.timeoutMs, 120_000, 24 * 60 * 60 * 1000);
    const intervalMs = Math.max(100, boundedMilliseconds(options.intervalMs, 2_500, 60_000));
    const until = options.until ?? "confirmed";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      const current = await this.get(intentId, { signal: options.signal ?? null });
      if (!current) throw new Error(`Intent ${intentId} was not found`);
      if (["REJECTED", "NODE_REJECTED", "CONFLICTED", "EXPIRED"].includes(current.status)) {
        return current;
      }
      if (until === "committed" && ["COMMITTED", "CONFIRMED"].includes(current.status)) return current;
      if (until === "confirmed" && current.status === "CONFIRMED") return current;
      if (until === "verified" && current.status === "CONFIRMED" && current.assertionStatus === "VERIFIED") return current;
      await delayUnlessAborted(Math.min(intervalMs, Math.max(0, deadline - Date.now())), options.signal);
    }
    if (options.signal?.aborted) throw abortReason(options.signal);
    const current = await this.get(intentId, { signal: options.signal ?? null });
    if (!current) throw new Error(`Intent ${intentId} was not found`);
    return current;
  }
}

export function createCellFlow(options: CellFlowClientOptions): CellFlowClient {
  return new CellFlowClient(options);
}
