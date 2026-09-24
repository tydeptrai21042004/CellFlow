export interface CellFlowClientOptions {
  endpoint: string;
  apiKey: string;
}

export interface TrackInput {
  intentId: string;
  txHash: string;
  metadata?: Record<string, unknown>;
  expectedCells?: unknown[];
}

export interface PrepareInput extends TrackInput {}

export interface IntentView {
  intentId: string;
  txHash: string | null;
  status: string;
  submissionStatus: string;
  chainStatus: string;
  workflowStatus: string;
  confirmationCount: number;
  assertionStatus: string | null;
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

export class CellFlowClient {
  readonly endpoint: string;

  constructor(private readonly options: CellFlowClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
        ...(init.headers ?? {}),
      },
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = (payload.error ?? {}) as Record<string, unknown>;
      throw new CellFlowHttpError(
        response.status,
        typeof error.code === "string" ? error.code : "HTTP_ERROR",
        typeof error.message === "string" ? error.message : `CellFlow request failed: HTTP ${response.status}`,
      );
    }
    return payload as T;
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
      { method: "POST", body: JSON.stringify({ txHash: input.txHash }) },
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

  async markAmbiguous(intentId: string): Promise<IntentView> {
    const result = await this.request<{ intent: IntentView }>(
      `/api/v1/intents/${encodeURIComponent(intentId)}/ambiguous`,
      { method: "POST", body: "{}" },
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

  async get(intentId: string): Promise<IntentView | null> {
    try {
      const result = await this.request<{ intent: IntentView }>(
        `/api/v1/intents/${encodeURIComponent(intentId)}`,
      );
      return result.intent;
    } catch (error) {
      if (error instanceof CellFlowHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async wait(
    intentId: string,
    options: { timeoutMs?: number; intervalMs?: number; until?: "committed" | "confirmed" } = {},
  ): Promise<IntentView> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 2_500;
    const until = options.until ?? "confirmed";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = await this.get(intentId);
      if (!current) throw new Error(`Intent ${intentId} was not found`);
      if (current.status === "REJECTED" || current.status === "CONFLICTED" || current.status === "EXPIRED") {
        return current;
      }
      if (until === "committed" && ["COMMITTED", "CONFIRMED"].includes(current.status)) return current;
      if (until === "confirmed" && current.status === "CONFIRMED") return current;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const current = await this.get(intentId);
    if (!current) throw new Error(`Intent ${intentId} was not found`);
    return current;
  }
}

export function createCellFlow(options: CellFlowClientOptions): CellFlowClient {
  return new CellFlowClient(options);
}
