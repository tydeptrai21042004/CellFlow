import { createHash, randomBytes } from "node:crypto";
import {
  buildEvidence,
  CellFlowError,
  deriveOverallStatus,
  normalizeIntentId,
  normalizeTxHash,
  parseConfirmationPolicy,
  updateSubmission,
} from "@cellflow/core";
import {
  CellFlowRepository,
  OptimisticConcurrencyError,
  snapshotFromExecution,
  type ApiKeyScope,
  type IntentAggregate,
  type OperationalHealthRecord,
  type ProjectRecord,
} from "@cellflow/db";
import { CkbRpcClient, reconcileIntent } from "@cellflow/reconcile";
import { encryptSecret, validateWebhookUrl } from "@cellflow/webhooks";
import { generateApiKey } from "./auth.ts";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function encryptionKey(): string {
  const key = process.env.CELLFLOW_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new CellFlowError("INTERNAL_ERROR", "CELLFLOW_ENCRYPTION_KEY is not configured", 500);
  }
  return key;
}

export class CellFlowService {
  constructor(readonly repository = new CellFlowRepository()) {}

  async setupProject(input: {
    name: string;
    network: ProjectRecord["network"];
    rpcUrl?: string;
    confirmationPolicy?: ProjectRecord["confirmationPolicy"];
  }): Promise<{ project: ProjectRecord; apiKey: string }> {
    let rpcUrl = input.rpcUrl;
    if (rpcUrl) {
      const validated = await validateWebhookUrl(rpcUrl, {
        allowHttpLocalhost: process.env.NODE_ENV !== "production",
      });
      rpcUrl = validated.toString();
      try {
        const info = await new CkbRpcClient([rpcUrl]).getBlockchainInfo();
        const chain = typeof info.chain === "string" ? info.chain : "";
        const expectedChain = input.network === "mainnet" ? "ckb" : input.network === "testnet" ? "ckb_testnet" : null;
        if (expectedChain && chain !== expectedChain) {
          throw new CellFlowError(
            "RPC_RESPONSE_INVALID",
            `RPC network mismatch: project expects ${input.network} but endpoint reports ${chain || "unknown"}`,
            400,
          );
        }
        if (info.is_initial_block_download === true && process.env.NODE_ENV === "production") {
          throw new CellFlowError("RPC_UNAVAILABLE", "RPC node is still in initial block download", 503);
        }
      } catch (error) {
        if (error instanceof CellFlowError) throw error;
        throw new CellFlowError(
          "RPC_UNAVAILABLE",
          "Unable to verify the configured CKB RPC endpoint",
          503,
        );
      }
    }
    const apiKey = generateApiKey();
    const project = await this.repository.createProject({
      name: input.name,
      network: input.network,
      rpcUrl: rpcUrl ?? null,
      confirmationPolicy: input.confirmationPolicy ?? parseConfirmationPolicy(
        process.env.DEFAULT_CONFIRMATION_POLICY ?? "depth:4",
      ),
      apiKeyId: apiKey.id,
      apiKeyPrefix: apiKey.prefix,
      apiKeyHash: apiKey.hash,
    });
    return { project, apiKey: apiKey.key };
  }

  async createIntent(project: ProjectRecord, input: {
    intentId: string;
    metadata: Record<string, unknown>;
    expectedCells: unknown[];
  }): Promise<{ view: Record<string, unknown>; created: boolean }> {
    const intentId = normalizeIntentId(input.intentId);
    const result = await this.repository.createIntent({
      project,
      intentId,
      metadata: input.metadata,
      expectedCells: input.expectedCells,
    });
    if (!result.created && (
      stable(result.aggregate.intent.metadata) !== stable(input.metadata) ||
      stable(result.aggregate.intent.expectedCells) !== stable(input.expectedCells)
    )) {
      throw new CellFlowError(
        "INTENT_CONFLICT",
        "The same intentId already exists with different metadata or expected Cell assertions",
        409,
      );
    }
    return { view: await this.repository.executionPublicView(result.aggregate), created: result.created };
  }

  async getIntent(project: ProjectRecord, intentId: string): Promise<IntentAggregate> {
    const aggregate = await this.repository.getIntent(project.id, normalizeIntentId(intentId));
    if (!aggregate) throw new CellFlowError("INTENT_NOT_FOUND", "Intent not found", 404);
    return aggregate;
  }

  async projectMetrics(project: ProjectRecord): Promise<{ total: number; active: number; confirmed: number; attention: number }> {
    return this.repository.getProjectMetrics(project.id);
  }

  async operationalHealth(project: ProjectRecord): Promise<OperationalHealthRecord> {
    const staleMinutes = Number(process.env.CELLFLOW_STALE_INTENT_MINUTES ?? "10");
    return this.repository.getOperationalHealth(
      project.id,
      Number.isFinite(staleMinutes) ? staleMinutes : 10,
    );
  }

  async projectEvidence(project: ProjectRecord, persist = false): Promise<Record<string, unknown>> {
    const [metrics, operations, webhooks] = await Promise.all([
      this.projectMetrics(project),
      this.operationalHealth(project),
      this.listWebhooks(project),
    ]);
    const document = {
      schemaVersion: "cellflow-project-evidence-v1",
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        network: project.network,
        confirmationPolicy: project.confirmationPolicy,
      },
      release: {
        version: "0.3.0",
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CELLFLOW_RELEASE_SHA ?? null,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      },
      metrics,
      operations,
      integrations: {
        webhookEndpoints: webhooks.map((item) => ({
          id: item.id,
          enabled: item.enabled,
          deliveredCount: item.deliveredCount,
          failedCount: item.failedCount,
          pendingCount: item.pendingCount,
          lastDeliveryAt: item.lastDeliveryAt,
        })),
        apiKeys: {
          active: operations.activeApiKeys,
          expiringWithin7Days: operations.expiringApiKeys7d,
        },
      },
    };
    const sha256 = createHash("sha256").update(stable(document)).digest("hex");
    if (!persist) return { ...document, sha256, persisted: false };
    const record = await this.repository.recordProjectEvidenceExport({
      projectId: project.id,
      sha256,
      document,
    });
    return { ...document, sha256, persisted: true, exportId: record.id, exportedAt: record.createdAt };
  }

  async listIntents(project: ProjectRecord, limit?: number): Promise<Record<string, unknown>[]> {
    const rows = await this.repository.listIntents(project.id, limit ?? 100);
    return Promise.all(rows.map((row) => this.repository.executionPublicView(row)));
  }

  async intentDetail(project: ProjectRecord, intentId: string): Promise<Record<string, unknown>> {
    const aggregate = await this.getIntent(project, intentId);
    const [view, events] = await Promise.all([
      this.repository.executionPublicView(aggregate),
      this.repository.getEvents(project.id, aggregate.intent.id),
    ]);
    return {
      ...view,
      network: aggregate.execution.network,
      metadata: aggregate.intent.metadata,
      expectedCells: aggregate.intent.expectedCells,
      events: events.map((event) => ({
        sequence: event.sequence,
        kind: event.kind,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        occurredAt: event.occurredAt,
      })),
    };
  }

  async attachTransaction(
    project: ProjectRecord,
    intentId: string,
    txHashInput: string,
    submissionStatus: "PREPARED" | "SUBMITTED",
  ): Promise<Record<string, unknown>> {
    const txHash = normalizeTxHash(txHashInput);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getIntent(project, intentId);
      if (current.execution.txHash && current.execution.txHash !== txHash) {
        throw new CellFlowError("INTENT_CONFLICT", "Intent is already bound to a different transaction hash", 409);
      }
      const before = snapshotFromExecution(current.execution);
      const after = updateSubmission(before, submissionStatus);
      try {
        const updated = await this.repository.attachTransaction({
          aggregate: current,
          txHash,
          submissionStatus,
          nextReconcileAt: submissionStatus === "SUBMITTED" ? new Date() : null,
          fromStatus: deriveOverallStatus(before),
          toStatus: deriveOverallStatus(after),
          reason: submissionStatus === "PREPARED"
            ? "Deterministic transaction hash persisted before broadcast"
            : "Transaction hash registered for reconciliation",
        });
        return this.repository.executionPublicView(updated);
      } catch (error) {
        if (error instanceof Error && error.message === "INTENT_TX_CONFLICT") {
          throw new CellFlowError("INTENT_CONFLICT", "Intent is already bound to a different transaction hash", 409);
        }
        if (!(error instanceof OptimisticConcurrencyError) || attempt === 2) throw error;
      }
    }
    throw new CellFlowError("INTERNAL_ERROR", "Concurrent attach retry exhausted", 503);
  }

  async markSubmission(
    project: ProjectRecord,
    intentId: string,
    status: "BROADCASTING" | "SUBMITTED" | "SUBMISSION_UNKNOWN",
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getIntent(project, intentId);
      if (!current.execution.txHash) {
        throw new CellFlowError("INVALID_TX_HASH", "Intent has no transaction hash", 400);
      }
      const before = snapshotFromExecution(current.execution);
      const after = updateSubmission(before, status);
      const reason = status === "SUBMISSION_UNKNOWN"
        ? "Broadcast response was ambiguous; reconcile by deterministic tx hash before retry"
        : status === "BROADCASTING"
          ? "Broadcast attempt started after transaction identity was persisted"
          : "CKB RPC accepted the broadcast request";
      try {
        const updated = await this.repository.markSubmissionStatus({
          aggregate: current,
          status,
          scheduleReconcile: status === "SUBMITTED" || status === "SUBMISSION_UNKNOWN",
          fromStatus: deriveOverallStatus(before),
          toStatus: deriveOverallStatus(after),
          reason,
        });
        return this.repository.executionPublicView(updated);
      } catch (error) {
        if (!(error instanceof OptimisticConcurrencyError) || attempt === 2) throw error;
      }
    }
    throw new CellFlowError("INTERNAL_ERROR", "Concurrent submission retry exhausted", 503);
  }

  async reconcile(project: ProjectRecord, intentId: string): Promise<Record<string, unknown>> {
    const aggregate = await this.getIntent(project, intentId);
    await reconcileIntent(aggregate, this.repository);
    const updated = await this.getIntent(project, intentId);
    return this.repository.executionPublicView(updated);
  }

  async addOperatorNote(project: ProjectRecord, intentId: string, note: string): Promise<Record<string, unknown>> {
    const aggregate = await this.getIntent(project, intentId);
    await this.repository.addOperatorNote({ aggregate, note });
    return this.intentDetail(project, intentId);
  }

  async evidence(project: ProjectRecord, intentId: string): Promise<Record<string, unknown>> {
    const aggregate = await this.getIntent(project, intentId);
    const events = await this.repository.getEvents(project.id, aggregate.intent.id);
    const document = buildEvidence({
      projectId: project.id,
      intentId: aggregate.intent.intentId,
      txHash: aggregate.execution.txHash,
      network: aggregate.execution.network,
      snapshot: snapshotFromExecution(aggregate.execution),
      assertionStatus: aggregate.execution.assertionStatus,
      createdAt: aggregate.intent.createdAt,
      updatedAt: events.at(-1)?.occurredAt ?? aggregate.intent.createdAt,
      events: events.map((event) => ({
        sequence: event.sequence,
        kind: event.kind,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        occurredAt: event.occurredAt,
        reason: event.reason,
        rawObservation: event.rawObservation,
      })),
    });
    const sha256 = createHash("sha256").update(stable(document)).digest("hex");
    const exportRecord = await this.repository.recordEvidenceExport({
      projectId: project.id,
      intentRowId: aggregate.intent.id,
      sha256,
      schemaVersion: document.schemaVersion,
      maxEventSequence: events.at(-1)?.sequence ?? 0,
      document,
    });
    return { ...document, sha256, exportId: exportRecord.id, exportedAt: exportRecord.createdAt };
  }

  async createApiKey(
    project: ProjectRecord,
    input: { label: string; scopes: ApiKeyScope[]; expiresInDays: number | null },
  ): Promise<{ id: string; prefix: string; label: string; scopes: ApiKeyScope[]; expiresAt: string | null; apiKey: string }> {
    const apiKey = generateApiKey();
    const expiresAt = input.expiresInDays === null
      ? null
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    await this.repository.createApiKey({
      projectId: project.id,
      id: apiKey.id,
      prefix: apiKey.prefix,
      hash: apiKey.hash,
      label: input.label,
      scopes: input.scopes,
      expiresAt,
    });
    return {
      id: apiKey.id,
      prefix: apiKey.prefix,
      label: input.label,
      scopes: input.scopes,
      expiresAt: expiresAt?.toISOString() ?? null,
      apiKey: apiKey.key,
    };
  }

  async listApiKeys(project: ProjectRecord) {
    return this.repository.listApiKeys(project.id);
  }

  async revokeApiKey(project: ProjectRecord, keyId: string): Promise<void> {
    const result = await this.repository.revokeApiKey(project.id, keyId);
    if (result === "NOT_FOUND") throw new CellFlowError("API_KEY_NOT_FOUND", "API key not found", 404);
    if (result === "LAST_ACTIVE") throw new CellFlowError("TRANSITION_INVALID", "Create a replacement API key before revoking the last active key", 409);
  }

  async createWebhook(project: ProjectRecord, rawUrl: string): Promise<{
    id: string;
    url: string;
    signingSecret: string;
  }> {
    const url = await validateWebhookUrl(rawUrl, {
      allowHttpLocalhost: process.env.NODE_ENV !== "production",
    });
    const signingSecret = `whsec_${randomBytes(24).toString("base64url")}`;
    const endpoint = await this.repository.createWebhookEndpoint({
      projectId: project.id,
      url: url.toString(),
      signingSecretEncrypted: encryptSecret(signingSecret, encryptionKey()),
    });
    return { id: endpoint.id, url: endpoint.url, signingSecret };
  }

  async listWebhooks(project: ProjectRecord): Promise<Array<{
    id: string; url: string; secretVersion: number; enabled: boolean;
    deliveredCount: number; failedCount: number; pendingCount: number; lastDeliveryAt: string | null;
  }>> {
    const endpoints = await this.repository.listWebhookEndpoints(project.id);
    return endpoints.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      secretVersion: endpoint.secretVersion,
      enabled: endpoint.enabled,
      deliveredCount: endpoint.deliveredCount,
      failedCount: endpoint.failedCount,
      pendingCount: endpoint.pendingCount,
      lastDeliveryAt: endpoint.lastDeliveryAt,
    }));
  }

  async retryWebhookFailures(project: ProjectRecord, endpointId?: string): Promise<number> {
    if (endpointId) {
      const endpoint = await this.repository.getWebhookEndpoint(project.id, endpointId);
      if (!endpoint) throw new CellFlowError("WEBHOOK_NOT_FOUND", "Webhook endpoint not found", 404);
    }
    return this.repository.retryFailedWebhookDeliveries(project.id, endpointId);
  }

  async disableWebhook(project: ProjectRecord, endpointId: string): Promise<void> {
    const disabled = await this.repository.disableWebhookEndpoint(project.id, endpointId);
    if (!disabled) throw new CellFlowError("WEBHOOK_NOT_FOUND", "Active webhook endpoint not found", 404);
  }
}
