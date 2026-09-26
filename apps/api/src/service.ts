import { createHash, randomBytes } from "node:crypto";
import {
  buildEvidence,
  CellFlowError,
  deriveOverallStatus,
  normalizeIntentId,
  normalizeOutPointRefs,
  normalizeTxHash,
  parseConfirmationPolicy,
  updateSubmission,
  type OutPointRef,
  type SubmissionFailureEvidence,
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
import { CkbRpcClient, parseRpcUrls, reconcileIntent, type InputInspection } from "@cellflow/reconcile";
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

function projectRpcEndpoints(project: ProjectRecord): string[] {
  return parseRpcUrls(
    project.rpcUrl,
    process.env.CKB_RPC_URL,
    process.env.CKB_RPC_FALLBACK_URL,
    process.env.CKB_RPC_FALLBACK_URLS,
  );
}

function expectedChainForNetwork(network: ProjectRecord["network"]): string | null {
  if (network === "mainnet") return "ckb";
  if (network === "testnet") return "ckb_testnet";
  return null;
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
    let rpcGenesisHash = process.env.CKB_EXPECTED_GENESIS_HASH?.trim().toLowerCase() || null;
    if (rpcUrl) {
      const validated = await validateWebhookUrl(rpcUrl, {
        allowHttpLocalhost: process.env.NODE_ENV !== "production",
      });
      rpcUrl = validated.toString();
      try {
        const rpcClient = new CkbRpcClient([rpcUrl]);
        const [info, genesisHash] = await Promise.all([
          rpcClient.getBlockchainInfo(),
          rpcClient.getGenesisHash(),
        ]);
        const chain = typeof info.chain === "string" ? info.chain : "";
        const expectedChain = input.network === "mainnet" ? "ckb" : input.network === "testnet" ? "ckb_testnet" : null;
        if (expectedChain && chain !== expectedChain) {
          throw new CellFlowError(
            "RPC_RESPONSE_INVALID",
            `RPC network mismatch: project expects ${input.network} but endpoint reports ${chain || "unknown"}`,
            400,
          );
        }
        const observedGenesis = genesisHash?.trim().toLowerCase() ?? null;
        if (!observedGenesis || !/^0x[0-9a-f]{64}$/.test(observedGenesis)) {
          throw new CellFlowError("RPC_RESPONSE_INVALID", "RPC returned an invalid genesis block hash", 400);
        }
        const configuredGenesis = process.env.CKB_EXPECTED_GENESIS_HASH?.trim().toLowerCase();
        if (configuredGenesis && observedGenesis !== configuredGenesis) {
          throw new CellFlowError("RPC_RESPONSE_INVALID", "RPC genesis hash does not match CKB_EXPECTED_GENESIS_HASH", 400);
        }
        rpcGenesisHash = observedGenesis;
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
      rpcGenesisHash,
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
        rpcGenesisHash: project.rpcGenesisHash,
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
    const snapshotSha256 = createHash("sha256").update(stable(document)).digest("hex");
    const { generatedAt: _generatedAt, ...contentDocument } = document;
    const contentSha256 = createHash("sha256").update(stable(contentDocument)).digest("hex");
    if (!persist) {
      return { ...document, sha256: snapshotSha256, snapshotSha256, contentSha256, persisted: false };
    }
    const record = await this.repository.recordProjectEvidenceExport({
      projectId: project.id,
      sha256: snapshotSha256,
      document: { ...document, contentSha256 },
    });
    return {
      ...document,
      sha256: snapshotSha256,
      snapshotSha256,
      contentSha256,
      persisted: true,
      exportId: record.id,
      exportedAt: record.createdAt,
    };
  }

  private decodeIntentCursor(value?: string | null): { createdAt: string; id: string } | null {
    if (!value) return null;
    if (value.length > 512) throw new CellFlowError("INVALID_CURSOR", "Cursor is too long", 400);
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
      if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))) throw new Error("createdAt");
      if (typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error("id");
      return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
    } catch {
      throw new CellFlowError("INVALID_CURSOR", "Cursor is invalid or expired", 400);
    }
  }

  private encodeIntentCursor(cursor: { createdAt: string; id: string } | null): string | null {
    return cursor ? Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url") : null;
  }

  async listIntents(
    project: ProjectRecord,
    limit?: number,
    cursor?: string | null,
  ): Promise<{ intents: Record<string, unknown>[]; nextCursor: string | null }> {
    const page = await this.repository.listIntentsPage(project.id, limit ?? 100, this.decodeIntentCursor(cursor));
    return {
      intents: await Promise.all(page.items.map((row) => this.repository.executionPublicView(row))),
      nextCursor: this.encodeIntentCursor(page.nextCursor),
    };
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
    inputOutPoints?: OutPointRef[],
  ): Promise<Record<string, unknown>> {
    const txHash = normalizeTxHash(txHashInput);
    const normalizedInputs = inputOutPoints === undefined ? undefined : normalizeOutPointRefs(inputOutPoints);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getIntent(project, intentId);
      if (current.execution.txHash && current.execution.txHash !== txHash) {
        throw new CellFlowError("INTENT_CONFLICT", "Intent is already bound to a different transaction hash", 409);
      }
      if (
        normalizedInputs && normalizedInputs.length > 0 &&
        current.execution.inputOutPoints.length > 0 &&
        JSON.stringify(current.execution.inputOutPoints) !== JSON.stringify(normalizedInputs)
      ) {
        throw new CellFlowError(
          "INTENT_CONFLICT",
          "Persisted input OutPoints do not match the existing evidence for this transaction hash",
          409,
        );
      }
      const before = snapshotFromExecution(current.execution);
      const after = updateSubmission(before, submissionStatus);
      try {
        const updated = await this.repository.attachTransaction({
          aggregate: current,
          txHash,
          submissionStatus,
          ...(normalizedInputs ? { inputOutPoints: normalizedInputs } : {}),
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

  async preflight(project: ProjectRecord, intentId: string): Promise<Record<string, unknown>> {
    const aggregate = await this.getIntent(project, intentId);
    if (!aggregate.execution.txHash) {
      throw new CellFlowError("INVALID_TX_HASH", "Intent has no prepared transaction hash", 400);
    }
    if (aggregate.execution.inputOutPoints.length === 0) {
      throw new CellFlowError(
        "INVALID_SIGNED_TRANSACTION",
        "Input preflight requires the prepared transaction input OutPoints",
        409,
      );
    }

    const urls = projectRpcEndpoints(project);
    if (urls.length === 0) {
      throw new CellFlowError("RPC_UNAVAILABLE", "No CKB RPC endpoint configured", 503);
    }
    const client = new CkbRpcClient(urls);
    const status = deriveOverallStatus(snapshotFromExecution(aggregate.execution));

    let inspection: InputInspection;
    try {
      inspection = await client.inspectInputOutPoints(aggregate.execution.inputOutPoints, {
        chain: expectedChainForNetwork(project.network),
        genesisHash: project.rpcGenesisHash ?? process.env.CKB_EXPECTED_GENESIS_HASH ?? null,
      });
    } catch (error) {
      await this.repository.appendEvent({
        aggregate,
        kind: "INPUT_PREFLIGHT_FAILED",
        fromStatus: status,
        toStatus: status,
        reason: "Direct CKB RPC input preflight could not obtain trustworthy evidence",
        rawObservation: {
          state: "RPC_UNCERTAIN",
          error: error instanceof Error ? error.message : "Input preflight RPC failed",
        },
      });
      throw error;
    }

    if (inspection.state !== "ALL_LIVE") {
      await this.repository.appendEvent({
        aggregate,
        kind: "INPUT_PREFLIGHT_FAILED",
        fromStatus: status,
        toStatus: status,
        reason: `Input preflight blocked broadcast: ${inspection.state}`,
        rawObservation: inspection,
      });
      const errorCode = inspection.state === "MEMPOOL_CONTENDED"
        ? "INPUTS_CONTENDED"
        : inspection.state === "CANONICALLY_SPENT"
          ? "INPUTS_NOT_LIVE"
          : "INPUT_STATE_UNCERTAIN";
      throw new CellFlowError(
        errorCode,
        `Input preflight blocked broadcast: ${inspection.state}`,
        inspection.state === "UNKNOWN" ? 503 : 409,
        { inspectionState: inspection.state },
      );
    }

    await this.repository.appendEvent({
      aggregate,
      kind: "INPUT_PREFLIGHT_VERIFIED",
      fromStatus: status,
      toStatus: status,
      reason: "All original input OutPoints are canonically live and available against tx-pool state",
      rawObservation: inspection,
    });
    return this.repository.executionPublicView(aggregate);
  }

  async markSubmission(
    project: ProjectRecord,
    intentId: string,
    status: "BROADCASTING" | "SUBMITTED" | "SUBMISSION_UNKNOWN" | "NODE_REJECTED",
    failure?: SubmissionFailureEvidence,
  ): Promise<Record<string, unknown>> {
    if (status === "NODE_REJECTED" && failure?.errorType !== "RPC_REJECTION") {
      throw new CellFlowError(
        "TRANSITION_INVALID",
        "NODE_REJECTED requires RPC_REJECTION evidence",
        400,
      );
    }
    if (status === "SUBMISSION_UNKNOWN" && failure?.errorType === "RPC_REJECTION") {
      throw new CellFlowError(
        "TRANSITION_INVALID",
        "Explicit RPC rejection cannot be recorded as SUBMISSION_UNKNOWN",
        400,
      );
    }
    if (failure?.conflictType && failure.conflictType !== "INPUT_CONFLICT_SUSPECTED") {
      throw new CellFlowError(
        "TRANSITION_INVALID",
        "Broadcast classification may only record INPUT_CONFLICT_SUSPECTED before direct chain inspection",
        400,
      );
    }
    if (status === "SUBMISSION_UNKNOWN" && failure?.conflictType) {
      throw new CellFlowError(
        "TRANSITION_INVALID",
        "Ambiguous transport failures cannot claim an input conflict",
        400,
      );
    }
    if (!["NODE_REJECTED", "SUBMISSION_UNKNOWN"].includes(status) && failure) {
      throw new CellFlowError(
        "TRANSITION_INVALID",
        `Submission failure evidence is not valid for ${status}`,
        400,
      );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getIntent(project, intentId);
      if (!current.execution.txHash) {
        throw new CellFlowError("INVALID_TX_HASH", "Intent has no transaction hash", 400);
      }
      const before = snapshotFromExecution(current.execution);
      const after = updateSubmission(before, status);
      const reason = status === "SUBMISSION_UNKNOWN"
        ? "Broadcast response was ambiguous; reconcile by deterministic tx hash before retry"
        : status === "NODE_REJECTED"
          ? "CKB RPC explicitly rejected the broadcast request; rejection is submission-layer evidence, not proof of canonical input spend"
          : status === "BROADCASTING"
            ? "Broadcast attempt started after transaction identity was persisted"
            : "CKB RPC accepted the broadcast request";
      try {
        const updated = await this.repository.markSubmissionStatus({
          aggregate: current,
          status,
          scheduleReconcile:
            status === "SUBMITTED" ||
            status === "SUBMISSION_UNKNOWN" ||
            (status === "NODE_REJECTED" && failure?.conflictType === "INPUT_CONFLICT_SUSPECTED"),
          fromStatus: deriveOverallStatus(before),
          toStatus: deriveOverallStatus(after),
          reason,
          submissionErrorCode: failure?.errorCode ?? null,
          submissionErrorType: failure?.errorType ?? null,
          submissionErrorDetails: failure ? {
            message: failure.errorMessage ?? null,
            ...(failure.details ?? {}),
          } : null,
          conflictType: failure?.conflictType ?? null,
          conflictDetails: failure?.conflictType ? {
            source: "broadcast",
            canonicalSpendConfirmed: false,
          } : null,
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

  async evidence(project: ProjectRecord, intentId: string, persist = false): Promise<Record<string, unknown>> {
    const aggregate = await this.getIntent(project, intentId);
    const events = await this.repository.getEvents(project.id, aggregate.intent.id);
    const document = buildEvidence({
      projectId: project.id,
      intentId: aggregate.intent.intentId,
      txHash: aggregate.execution.txHash,
      inputOutPoints: aggregate.execution.inputOutPoints,
      network: aggregate.execution.network,
      snapshot: snapshotFromExecution(aggregate.execution),
      assertionStatus: aggregate.execution.assertionStatus,
      submissionErrorCode: aggregate.execution.submissionErrorCode,
      submissionErrorType: aggregate.execution.submissionErrorType,
      submissionErrorDetails: aggregate.execution.submissionErrorDetails,
      conflictType: aggregate.execution.conflictType,
      conflictDetails: aggregate.execution.conflictDetails,
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
    if (!persist) return { ...document, sha256, persisted: false };
    const exportRecord = await this.repository.recordEvidenceExport({
      projectId: project.id,
      intentRowId: aggregate.intent.id,
      sha256,
      schemaVersion: document.schemaVersion,
      maxEventSequence: events.at(-1)?.sequence ?? 0,
      document,
    });
    return { ...document, sha256, persisted: true, exportId: exportRecord.id, exportedAt: exportRecord.createdAt };
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
    if (result === "LAST_ADMIN") throw new CellFlowError("TRANSITION_INVALID", "Create another active admin API key before revoking the last admin key", 409);
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
