import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { deriveOverallStatus, type ConfirmationPolicy, type ExecutionSnapshot } from "@cellflow/core";
import { getSql } from "./client.js";
import type {
  EvidenceExportRecord,
  ExecutionRecord,
  IntentAggregate,
  IntentRecord,
  ProjectRecord,
  StateEventRecord,
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
} from "./types.js";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    network: row.network as ProjectRecord["network"],
    rpcUrl: row.rpc_url ? String(row.rpc_url) : null,
    confirmationPolicy: row.confirmation_policy as ConfirmationPolicy,
    createdAt: iso(row.created_at as Date | string),
  };
}

function mapIntent(row: Record<string, unknown>): IntentRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    intentId: String(row.intent_id),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    expectedCells: (row.expected_cells ?? []) as unknown[],
    createdAt: iso(row.created_at as Date | string),
    updatedAt: iso(row.updated_at as Date | string),
  };
}

function mapExecution(row: Record<string, unknown>): ExecutionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    intentRowId: String(row.intent_row_id),
    txHash: row.tx_hash ? String(row.tx_hash) : null,
    network: String(row.network),
    submissionStatus: row.submission_status as ExecutionRecord["submissionStatus"],
    chainStatus: row.chain_status as ExecutionRecord["chainStatus"],
    workflowStatus: row.workflow_status as ExecutionRecord["workflowStatus"],
    confirmationPolicy: row.confirmation_policy as ConfirmationPolicy,
    confirmationCount: Number(row.confirmation_count),
    committedBlockHash: row.committed_block_hash ? String(row.committed_block_hash) : null,
    committedBlockNumber: row.committed_block_number ? String(row.committed_block_number) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    assertionStatus: row.assertion_status ? String(row.assertion_status) : null,
    assertionResult: row.assertion_result ?? null,
    lastRawObservation: row.last_raw_observation ?? null,
    lastObservedAt: row.last_observed_at ? iso(row.last_observed_at as Date | string) : null,
    nextReconcileAt: row.next_reconcile_at ? iso(row.next_reconcile_at as Date | string) : null,
    reconcileAttempts: Number(row.reconcile_attempts),
    version: Number(row.version),
    reconcileLeaseId: row.reconcile_lease_id ? String(row.reconcile_lease_id) : null,
    reconcileLeaseUntil: row.reconcile_lease_until ? iso(row.reconcile_lease_until as Date | string) : null,
    workflowRunId: row.workflow_run_id ? String(row.workflow_run_id) : null,
    workflowStartedAt: row.workflow_started_at ? iso(row.workflow_started_at as Date | string) : null,
    workflowCompletedAt: row.workflow_completed_at ? iso(row.workflow_completed_at as Date | string) : null,
    createdAt: iso(row.created_at as Date | string),
    updatedAt: iso(row.updated_at as Date | string),
  };
}

function webhookEventType(kind: string, status: string): string {
  if (kind === "CREATED") return "intent.created";
  if (kind === "ASSERTION_VERIFIED") return "intent.assertion_verified";
  if (kind === "ASSERTION_FAILED") return "intent.assertion_failed";
  if (kind === "REORG_DETECTED") return "intent.reorged";
  if (kind === "CONFIRMED") return "intent.confirmed";
  return `intent.${status.toLowerCase()}`;
}

export class OptimisticConcurrencyError extends Error {
  constructor(message = "Execution changed concurrently") {
    super(message);
    this.name = "OptimisticConcurrencyError";
  }
}

export class CellFlowRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async ping(): Promise<boolean> {
    const rows = await this.sql`select 1 as ok`;
    return Number(rows[0]?.ok) === 1;
  }

  private async insertEventAndOutbox(tx: Sql, input: {
    projectId: string;
    intentRowId: string;
    executionId: string;
    intentId: string;
    txHash: string | null;
    kind: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string;
    rawObservation?: unknown;
    occurredAt: Date;
    snapshot: ExecutionSnapshot;
    assertionStatus?: string | null;
  }): Promise<string> {
    const eventId = randomUUID();
    await tx`
      insert into state_events (
        id, project_id, intent_row_id, execution_id, kind,
        from_status, to_status, reason, raw_observation, occurred_at
      ) values (
        ${eventId}, ${input.projectId}, ${input.intentRowId}, ${input.executionId}, ${input.kind},
        ${input.fromStatus}, ${input.toStatus}, ${input.reason ?? null},
        ${input.rawObservation === undefined ? null : tx.json(input.rawObservation)}, ${input.occurredAt}
      )
    `;

    const eventType = webhookEventType(input.kind, input.toStatus);
    const payload = {
      id: eventId,
      type: eventType,
      occurredAt: input.occurredAt.toISOString(),
      data: {
        intentId: input.intentId,
        txHash: input.txHash,
        status: input.toStatus,
        submissionStatus: input.snapshot.submissionStatus,
        chainStatus: input.snapshot.chainStatus,
        workflowStatus: input.snapshot.workflowStatus,
        confirmationCount: input.snapshot.confirmationCount,
        assertionStatus: input.assertionStatus ?? null,
      },
    };
    await tx`
      insert into webhook_deliveries (
        id, project_id, endpoint_id, event_id, event_type, payload, next_attempt_at
      )
      select
        gen_random_uuid()::text, ${input.projectId}, w.id, ${eventId}, ${eventType}, ${tx.json(payload)}, now()
      from webhook_endpoints w
      where w.project_id = ${input.projectId} and w.enabled = true
      on conflict (endpoint_id, event_id) do nothing
    `;
    return eventId;
  }

  async createProject(input: {
    name: string;
    network: ProjectRecord["network"];
    rpcUrl?: string | null;
    confirmationPolicy: ConfirmationPolicy;
    apiKeyId: string;
    apiKeyPrefix: string;
    apiKeyHash: string;
  }): Promise<ProjectRecord> {
    const projectId = randomUUID();
    return this.sql.begin(async (tx) => {
      const projectRows = await tx`
        insert into projects (id, name, network, rpc_url, confirmation_policy)
        values (${projectId}, ${input.name}, ${input.network}, ${input.rpcUrl ?? null}, ${tx.json(input.confirmationPolicy)})
        returning *
      `;
      await tx`
        insert into api_keys (id, project_id, key_prefix, key_hash)
        values (${input.apiKeyId}, ${projectId}, ${input.apiKeyPrefix}, ${input.apiKeyHash})
      `;
      const row = projectRows[0];
      if (!row) throw new Error("Failed to create project");
      return mapProject(row);
    });
  }

  async findProjectByApiKeyHash(hash: string): Promise<ProjectRecord | null> {
    const rows = await this.sql`
      select p.* from projects p
      join api_keys k on k.project_id = p.id
      where k.key_hash = ${hash} and k.revoked_at is null
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    void this.sql`update api_keys set last_used_at = now() where key_hash = ${hash}`;
    return mapProject(row);
  }

  async createApiKey(input: { projectId: string; id: string; prefix: string; hash: string; label: string }): Promise<void> {
    await this.sql`
      insert into api_keys (id, project_id, key_prefix, key_hash, label)
      values (${input.id}, ${input.projectId}, ${input.prefix}, ${input.hash}, ${input.label})
    `;
  }

  async listApiKeys(projectId: string): Promise<Array<{
    id: string; prefix: string; label: string; revokedAt: string | null; lastUsedAt: string | null; createdAt: string;
  }>> {
    const rows = await this.sql`
      select id, key_prefix, label, revoked_at, last_used_at, created_at
      from api_keys where project_id = ${projectId} order by created_at asc
    `;
    return rows.map((row) => ({
      id: String(row.id), prefix: String(row.key_prefix), label: String(row.label),
      revokedAt: row.revoked_at ? iso(row.revoked_at as Date | string) : null,
      lastUsedAt: row.last_used_at ? iso(row.last_used_at as Date | string) : null,
      createdAt: iso(row.created_at as Date | string),
    }));
  }

  async revokeApiKey(projectId: string, keyId: string): Promise<"REVOKED" | "NOT_FOUND" | "LAST_ACTIVE"> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`select id, revoked_at from api_keys where project_id = ${projectId} and id = ${keyId} for update`;
      if (!rows[0]) return "NOT_FOUND" as const;
      if (rows[0].revoked_at) return "REVOKED" as const;
      const active = await tx`select count(*)::int as count from api_keys where project_id = ${projectId} and revoked_at is null`;
      if (Number(active[0]?.count ?? 0) <= 1) return "LAST_ACTIVE" as const;
      await tx`update api_keys set revoked_at = now() where project_id = ${projectId} and id = ${keyId}`;
      return "REVOKED" as const;
    });
  }

  async consumeRateLimit(projectId: string, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
    const rows = await this.sql`
      insert into rate_limit_windows (project_id, bucket, window_start, request_count)
      values (
        ${projectId}, ${bucket},
        to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1
      )
      on conflict (project_id, bucket, window_start)
      do update set request_count = rate_limit_windows.request_count + 1
      returning request_count
    `;
    return Number(rows[0]?.request_count ?? limit + 1) <= limit;
  }


  async pruneRateLimits(olderThanHours = 24): Promise<number> {
    const rows = await this.sql`
      delete from rate_limit_windows
      where window_start < now() - (${Math.max(1, Math.min(olderThanHours, 720))} * interval '1 hour')
      returning project_id
    `;
    return rows.length;
  }

  async createIntent(input: {
    project: ProjectRecord;
    intentId: string;
    metadata: Record<string, unknown>;
    expectedCells: unknown[];
    txHash?: string | null;
    submissionStatus?: ExecutionRecord["submissionStatus"];
  }): Promise<{ aggregate: IntentAggregate; created: boolean }> {
    let created = false;
    await this.sql.begin(async (tx) => {
      const intentRowId = randomUUID();
      const inserted = await tx`
        insert into intents (id, project_id, intent_id, metadata, expected_cells)
        values (${intentRowId}, ${input.project.id}, ${input.intentId}, ${tx.json(input.metadata)}, ${tx.json(input.expectedCells)})
        on conflict (project_id, intent_id) do nothing
        returning *
      `;
      if (inserted.length === 0) return;
      created = true;
      const executionId = randomUUID();
      const submissionStatus = input.submissionStatus ?? (input.txHash ? "SUBMITTED" : "NOT_SUBMITTED");
      const snapshot: ExecutionSnapshot = {
        submissionStatus,
        chainStatus: "UNOBSERVED",
        workflowStatus: "IDLE",
        confirmationPolicy: input.project.confirmationPolicy,
        confirmationCount: 0,
      };
      await tx`
        insert into executions (
          id, project_id, intent_row_id, tx_hash, network,
          submission_status, chain_status, workflow_status, confirmation_policy, next_reconcile_at
        ) values (
          ${executionId}, ${input.project.id}, ${intentRowId}, ${input.txHash ?? null}, ${input.project.network},
          ${submissionStatus}, 'UNOBSERVED', 'IDLE', ${tx.json(input.project.confirmationPolicy)},
          ${input.txHash ? new Date() : null}
        )
      `;
      await this.insertEventAndOutbox(tx as Sql, {
        projectId: input.project.id,
        intentRowId,
        executionId,
        intentId: input.intentId,
        txHash: input.txHash ?? null,
        kind: "CREATED",
        fromStatus: null,
        toStatus: deriveOverallStatus(snapshot),
        reason: "Intent accepted and persisted atomically with its audit event",
        occurredAt: new Date(),
        snapshot,
      });
    });
    const aggregate = await this.getIntent(input.project.id, input.intentId);
    if (!aggregate) throw new Error("Intent upsert failed");
    return { aggregate, created };
  }

  async getIntent(projectId: string, intentId: string): Promise<IntentAggregate | null> {
    const rows = await this.sql`
      select
        i.id as i_id, i.project_id as i_project_id, i.intent_id as i_intent_id,
        i.metadata as i_metadata, i.expected_cells as i_expected_cells,
        i.created_at as i_created_at, i.updated_at as i_updated_at,
        e.*
      from intents i join executions e on e.intent_row_id = i.id
      where i.project_id = ${projectId} and i.intent_id = ${intentId}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      intent: mapIntent({
        id: row.i_id, project_id: row.i_project_id, intent_id: row.i_intent_id,
        metadata: row.i_metadata, expected_cells: row.i_expected_cells,
        created_at: row.i_created_at, updated_at: row.i_updated_at,
      }),
      execution: mapExecution(row),
    };
  }

  async listIntents(projectId: string, limit = 100): Promise<IntentAggregate[]> {
    const rows = await this.sql`
      select
        i.id as i_id, i.project_id as i_project_id, i.intent_id as i_intent_id,
        i.metadata as i_metadata, i.expected_cells as i_expected_cells,
        i.created_at as i_created_at, i.updated_at as i_updated_at,
        e.*
      from intents i join executions e on e.intent_row_id = i.id
      where i.project_id = ${projectId}
      order by i.created_at desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
    return rows.map((row) => ({
      intent: mapIntent({
        id: row.i_id, project_id: row.i_project_id, intent_id: row.i_intent_id,
        metadata: row.i_metadata, expected_cells: row.i_expected_cells,
        created_at: row.i_created_at, updated_at: row.i_updated_at,
      }),
      execution: mapExecution(row),
    }));
  }

  async attachTransaction(input: {
    aggregate: IntentAggregate;
    txHash: string;
    submissionStatus: ExecutionRecord["submissionStatus"];
    nextReconcileAt?: Date | null;
    fromStatus: string;
    toStatus: string;
    reason: string;
  }): Promise<IntentAggregate> {
    if (input.aggregate.execution.txHash && input.aggregate.execution.txHash !== input.txHash) {
      throw new Error("INTENT_TX_CONFLICT");
    }
    await this.sql.begin(async (tx) => {
      const updated = await tx`
        update executions
        set tx_hash = ${input.txHash}, submission_status = ${input.submissionStatus},
            next_reconcile_at = ${input.nextReconcileAt ?? null}, version = version + 1, updated_at = now()
        where id = ${input.aggregate.execution.id}
          and project_id = ${input.aggregate.intent.projectId}
          and version = ${input.aggregate.execution.version}
        returning *
      `;
      const row = updated[0];
      if (!row) throw new OptimisticConcurrencyError();
      const snapshot: ExecutionSnapshot = {
        submissionStatus: input.submissionStatus,
        chainStatus: input.aggregate.execution.chainStatus,
        workflowStatus: input.aggregate.execution.workflowStatus,
        confirmationPolicy: input.aggregate.execution.confirmationPolicy,
        confirmationCount: input.aggregate.execution.confirmationCount,
        ...(input.aggregate.execution.committedBlockHash ? { committedBlockHash: input.aggregate.execution.committedBlockHash } : {}),
        ...(input.aggregate.execution.committedBlockNumber ? { committedBlockNumber: input.aggregate.execution.committedBlockNumber } : {}),
      };
      await this.insertEventAndOutbox(tx as Sql, {
        projectId: input.aggregate.intent.projectId,
        intentRowId: input.aggregate.intent.id,
        executionId: input.aggregate.execution.id,
        intentId: input.aggregate.intent.intentId,
        txHash: input.txHash,
        kind: "SUBMISSION_UPDATED",
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        occurredAt: new Date(),
        snapshot,
        assertionStatus: input.aggregate.execution.assertionStatus,
      });
      await tx`update intents set updated_at = now() where id = ${input.aggregate.intent.id}`;
    });
    const result = await this.getIntent(input.aggregate.intent.projectId, input.aggregate.intent.intentId);
    if (!result) throw new Error("Intent disappeared after transaction attach");
    return result;
  }

  async markSubmissionStatus(input: {
    aggregate: IntentAggregate;
    status: ExecutionRecord["submissionStatus"];
    scheduleReconcile?: boolean;
    fromStatus: string;
    toStatus: string;
    reason: string;
  }): Promise<IntentAggregate> {
    await this.sql.begin(async (tx) => {
      const updated = await tx`
        update executions
        set submission_status = ${input.status},
            next_reconcile_at = ${input.scheduleReconcile ? new Date() : input.aggregate.execution.nextReconcileAt},
            version = version + 1, updated_at = now()
        where id = ${input.aggregate.execution.id}
          and project_id = ${input.aggregate.intent.projectId}
          and version = ${input.aggregate.execution.version}
        returning id
      `;
      if (updated.length !== 1) throw new OptimisticConcurrencyError();
      const snapshot: ExecutionSnapshot = {
        submissionStatus: input.status,
        chainStatus: input.aggregate.execution.chainStatus,
        workflowStatus: input.aggregate.execution.workflowStatus,
        confirmationPolicy: input.aggregate.execution.confirmationPolicy,
        confirmationCount: input.aggregate.execution.confirmationCount,
        ...(input.aggregate.execution.committedBlockHash ? { committedBlockHash: input.aggregate.execution.committedBlockHash } : {}),
        ...(input.aggregate.execution.committedBlockNumber ? { committedBlockNumber: input.aggregate.execution.committedBlockNumber } : {}),
      };
      await this.insertEventAndOutbox(tx as Sql, {
        projectId: input.aggregate.intent.projectId,
        intentRowId: input.aggregate.intent.id,
        executionId: input.aggregate.execution.id,
        intentId: input.aggregate.intent.intentId,
        txHash: input.aggregate.execution.txHash,
        kind: "SUBMISSION_UPDATED",
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        occurredAt: new Date(),
        snapshot,
        assertionStatus: input.aggregate.execution.assertionStatus,
      });
    });
    const result = await this.getIntent(input.aggregate.intent.projectId, input.aggregate.intent.intentId);
    if (!result) throw new Error("Intent disappeared after submission update");
    return result;
  }

  async applySnapshot(input: {
    aggregate: IntentAggregate;
    snapshot: ExecutionSnapshot;
    event: {
      kind: string;
      fromStatus: string | null;
      toStatus: string;
      reason?: string;
      rawObservation?: unknown;
      occurredAt: string;
    };
    nextReconcileAt: Date | null;
    assertionStatus?: string | null;
    assertionResult?: unknown;
  }): Promise<string | null> {
    const prior = input.aggregate.execution;
    const nextAssertionStatus = input.assertionStatus ?? prior.assertionStatus;
    const meaningful =
      prior.submissionStatus !== input.snapshot.submissionStatus ||
      prior.chainStatus !== input.snapshot.chainStatus ||
      prior.workflowStatus !== input.snapshot.workflowStatus ||
      prior.committedBlockHash !== (input.snapshot.committedBlockHash ?? null) ||
      prior.committedBlockNumber !== (input.snapshot.committedBlockNumber ?? null) ||
      prior.rejectionReason !== (input.snapshot.rejectionReason ?? null) ||
      prior.assertionStatus !== nextAssertionStatus;

    return this.sql.begin(async (tx) => {
      const updated = await tx`
        update executions set
          submission_status = ${input.snapshot.submissionStatus},
          chain_status = ${input.snapshot.chainStatus},
          workflow_status = ${input.snapshot.workflowStatus},
          confirmation_count = ${input.snapshot.confirmationCount},
          committed_block_hash = ${input.snapshot.committedBlockHash ?? null},
          committed_block_number = ${input.snapshot.committedBlockNumber ?? null},
          rejection_reason = ${input.snapshot.rejectionReason ?? null},
          assertion_status = ${nextAssertionStatus},
          assertion_result = ${input.assertionResult === undefined ? prior.assertionResult : tx.json(input.assertionResult)},
          last_raw_observation = ${input.event.rawObservation === undefined ? prior.lastRawObservation : tx.json(input.event.rawObservation)},
          last_observed_at = ${input.event.rawObservation === undefined ? prior.lastObservedAt : new Date(input.event.occurredAt)},
          next_reconcile_at = ${input.nextReconcileAt},
          reconcile_attempts = reconcile_attempts + 1,
          version = version + 1,
          updated_at = now()
        where id = ${prior.id} and project_id = ${input.aggregate.intent.projectId} and version = ${prior.version}
        returning id
      `;
      if (updated.length !== 1) throw new OptimisticConcurrencyError();
      await tx`update intents set updated_at = now() where id = ${input.aggregate.intent.id}`;
      if (!meaningful) return null;
      return this.insertEventAndOutbox(tx as Sql, {
        projectId: input.aggregate.intent.projectId,
        intentRowId: input.aggregate.intent.id,
        executionId: prior.id,
        intentId: input.aggregate.intent.intentId,
        txHash: prior.txHash,
        kind: input.event.kind,
        fromStatus: input.event.fromStatus,
        toStatus: input.event.toStatus,
        ...(input.event.reason ? { reason: input.event.reason } : {}),
        ...(input.event.rawObservation === undefined ? {} : { rawObservation: input.event.rawObservation }),
        occurredAt: new Date(input.event.occurredAt),
        snapshot: input.snapshot,
        assertionStatus: nextAssertionStatus,
      });
    });
  }

  async appendEvent(input: {
    aggregate: IntentAggregate;
    kind: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string;
    rawObservation?: unknown;
  }): Promise<string> {
    return this.sql.begin(async (tx) => this.insertEventAndOutbox(tx as Sql, {
      projectId: input.aggregate.intent.projectId,
      intentRowId: input.aggregate.intent.id,
      executionId: input.aggregate.execution.id,
      intentId: input.aggregate.intent.intentId,
      txHash: input.aggregate.execution.txHash,
      kind: input.kind,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.rawObservation === undefined ? {} : { rawObservation: input.rawObservation }),
      occurredAt: new Date(),
      snapshot: {
        submissionStatus: input.aggregate.execution.submissionStatus,
        chainStatus: input.aggregate.execution.chainStatus,
        workflowStatus: input.aggregate.execution.workflowStatus,
        confirmationPolicy: input.aggregate.execution.confirmationPolicy,
        confirmationCount: input.aggregate.execution.confirmationCount,
      },
      assertionStatus: input.aggregate.execution.assertionStatus,
    }));
  }

  async getEvents(projectId: string, intentRowId: string): Promise<StateEventRecord[]> {
    const rows = await this.sql`
      select sequence, id, kind, from_status, to_status, reason, raw_observation, occurred_at
      from state_events where project_id = ${projectId} and intent_row_id = ${intentRowId}
      order by sequence asc
    `;
    return rows.map((row) => ({
      sequence: Number(row.sequence), id: String(row.id), kind: String(row.kind),
      fromStatus: row.from_status ? String(row.from_status) : null,
      toStatus: String(row.to_status), reason: row.reason ? String(row.reason) : null,
      rawObservation: row.raw_observation ?? null, occurredAt: iso(row.occurred_at as Date | string),
    }));
  }

  async claimDueExecutions(limit: number, leaseId: string, leaseSeconds = 60): Promise<IntentAggregate[]> {
    const claimed = await this.sql.begin(async (tx) => {
      const rows = await tx`
        select e.id, i.project_id, i.intent_id
        from executions e join intents i on i.id = e.intent_row_id
        where e.next_reconcile_at is not null and e.next_reconcile_at <= now()
          and e.workflow_status not in ('CONFLICTED', 'EXPIRED')
          and e.chain_status <> 'REJECTED'
          and (e.reconcile_lease_until is null or e.reconcile_lease_until < now())
        order by e.next_reconcile_at asc
        for update of e skip locked
        limit ${Math.min(Math.max(limit, 1), 100)}
      `;
      for (const row of rows) {
        await tx`
          update executions
          set reconcile_lease_id = ${leaseId}, reconcile_lease_until = now() + (${leaseSeconds} * interval '1 second')
          where id = ${String(row.id)}
        `;
      }
      return rows.map((row) => ({ projectId: String(row.project_id), intentId: String(row.intent_id) }));
    });
    const result: IntentAggregate[] = [];
    for (const row of claimed) {
      const aggregate = await this.getIntent(row.projectId, row.intentId);
      if (aggregate) result.push(aggregate);
    }
    return result;
  }

  async releaseReconcileLease(executionId: string, leaseId: string): Promise<void> {
    await this.sql`
      update executions set reconcile_lease_id = null, reconcile_lease_until = null
      where id = ${executionId} and reconcile_lease_id = ${leaseId}
    `;
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const rows = await this.sql`select * from projects where id = ${projectId} limit 1`;
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async claimWorkflowStart(projectId: string, intentId: string, claimId: string): Promise<string | null> {
    const rows = await this.sql`
      update executions e set
        workflow_run_id = ${claimId}, workflow_started_at = now(), workflow_completed_at = null
      from intents i
      where e.intent_row_id = i.id and i.project_id = ${projectId} and i.intent_id = ${intentId}
        and (e.workflow_run_id is null or e.workflow_completed_at is not null or e.workflow_started_at < now() - interval '24 hours')
      returning e.workflow_run_id
    `;
    if (rows.length === 1) return claimId;
    const current = await this.getIntent(projectId, intentId);
    return current?.execution.workflowRunId ?? null;
  }

  async replaceWorkflowClaim(projectId: string, intentId: string, claimId: string, runId: string): Promise<void> {
    await this.sql`
      update executions e set workflow_run_id = ${runId}
      from intents i
      where e.intent_row_id = i.id and i.project_id = ${projectId} and i.intent_id = ${intentId}
        and e.workflow_run_id = ${claimId}
    `;
  }

  async releaseWorkflowClaim(projectId: string, intentId: string, claimId: string): Promise<void> {
    await this.sql`
      update executions e set workflow_run_id = null, workflow_started_at = null
      from intents i
      where e.intent_row_id = i.id and i.project_id = ${projectId} and i.intent_id = ${intentId}
        and e.workflow_run_id = ${claimId}
    `;
  }

  async markWorkflowCompleted(projectId: string, intentId: string): Promise<void> {
    await this.sql`
      update executions e set workflow_completed_at = now()
      from intents i
      where e.intent_row_id = i.id and i.project_id = ${projectId} and i.intent_id = ${intentId}
    `;
  }

  async createWebhookEndpoint(input: { projectId: string; url: string; signingSecretEncrypted: string }): Promise<WebhookEndpointRecord> {
    const id = randomUUID();
    const rows = await this.sql`
      insert into webhook_endpoints (id, project_id, url, signing_secret_encrypted)
      values (${id}, ${input.projectId}, ${input.url}, ${input.signingSecretEncrypted})
      on conflict (project_id, url) do update set
        signing_secret_encrypted = excluded.signing_secret_encrypted, enabled = true,
        secret_version = webhook_endpoints.secret_version + 1, updated_at = now()
      returning *
    `;
    const row = rows[0];
    if (!row) throw new Error("Webhook endpoint creation failed");
    return {
      id: String(row.id), projectId: String(row.project_id), url: String(row.url),
      signingSecretEncrypted: String(row.signing_secret_encrypted), secretVersion: Number(row.secret_version), enabled: Boolean(row.enabled),
    };
  }

  async listWebhookEndpoints(projectId: string): Promise<WebhookEndpointRecord[]> {
    const rows = await this.sql`select * from webhook_endpoints where project_id = ${projectId} and enabled = true order by created_at asc`;
    return rows.map((row) => ({
      id: String(row.id), projectId: String(row.project_id), url: String(row.url),
      signingSecretEncrypted: String(row.signing_secret_encrypted), secretVersion: Number(row.secret_version), enabled: Boolean(row.enabled),
    }));
  }

  async enqueueWebhookDeliveries(input: { projectId: string; eventId: string; eventType: string; payload: unknown }): Promise<number> {
    const rows = await this.sql`
      insert into webhook_deliveries (id, project_id, endpoint_id, event_id, event_type, payload, next_attempt_at)
      select gen_random_uuid()::text, ${input.projectId}, w.id, ${input.eventId}, ${input.eventType}, ${this.sql.json(input.payload)}, now()
      from webhook_endpoints w where w.project_id = ${input.projectId} and w.enabled = true
      on conflict (endpoint_id, event_id) do nothing returning id
    `;
    return rows.length;
  }

  async claimDueWebhookDeliveries(limit: number, leaseOwner: string, leaseSeconds = 60, projectId?: string): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.sql.begin(async (tx) => {
      const candidates = projectId
        ? await tx`
            select id from webhook_deliveries
            where project_id = ${projectId}
              and (status in ('PENDING','RETRY') or (status = 'CLAIMED' and lease_until < now()))
              and coalesce(next_attempt_at, now()) <= now()
              and (lease_until is null or lease_until < now())
            order by next_attempt_at asc for update skip locked
            limit ${Math.min(Math.max(limit, 1), 100)}
          `
        : await tx`
            select id from webhook_deliveries
            where (status in ('PENDING','RETRY') or (status = 'CLAIMED' and lease_until < now()))
              and coalesce(next_attempt_at, now()) <= now()
              and (lease_until is null or lease_until < now())
            order by next_attempt_at asc for update skip locked
            limit ${Math.min(Math.max(limit, 1), 100)}
          `;
      if (candidates.length === 0) return [];
      const result = [];
      for (const candidate of candidates) {
        const updated = await tx`
          update webhook_deliveries set status = 'CLAIMED', lease_owner = ${leaseOwner},
            lease_until = now() + (${leaseSeconds} * interval '1 second'), updated_at = now()
          where id = ${String(candidate.id)} returning *
        `;
        if (updated[0]) result.push(updated[0]);
      }
      return result;
    });
    return rows.map((row) => ({
      id: String(row.id), projectId: String(row.project_id), endpointId: String(row.endpoint_id),
      eventId: String(row.event_id), eventType: String(row.event_type), payload: row.payload,
      attemptCount: Number(row.attempt_count), status: String(row.status),
      nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at as Date | string) : null,
      leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
      leaseUntil: row.lease_until ? iso(row.lease_until as Date | string) : null,
    }));
  }

  async getWebhookEndpoint(projectId: string, endpointId: string): Promise<WebhookEndpointRecord | null> {
    const rows = await this.sql`select * from webhook_endpoints where project_id = ${projectId} and id = ${endpointId} limit 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id), projectId: String(row.project_id), url: String(row.url),
      signingSecretEncrypted: String(row.signing_secret_encrypted), secretVersion: Number(row.secret_version), enabled: Boolean(row.enabled),
    };
  }

  async completeWebhookDelivery(input: {
    id: string;
    leaseOwner?: string;
    success: boolean;
    responseStatus?: number;
    error?: string;
    retryAt?: Date;
  }): Promise<void> {
    if (input.leaseOwner) {
      await this.sql`
        update webhook_deliveries set
          attempt_count = attempt_count + 1,
          status = ${input.success ? "DELIVERED" : input.retryAt ? "RETRY" : "FAILED"},
          response_status = ${input.responseStatus ?? null}, last_error = ${input.error ?? null},
          next_attempt_at = ${input.retryAt ?? null}, delivered_at = ${input.success ? new Date() : null},
          lease_owner = null, lease_until = null, updated_at = now()
        where id = ${input.id} and lease_owner = ${input.leaseOwner}
      `;
      return;
    }
    await this.sql`
      update webhook_deliveries set
        attempt_count = attempt_count + 1,
        status = ${input.success ? "DELIVERED" : input.retryAt ? "RETRY" : "FAILED"},
        response_status = ${input.responseStatus ?? null}, last_error = ${input.error ?? null},
        next_attempt_at = ${input.retryAt ?? null}, delivered_at = ${input.success ? new Date() : null},
        lease_owner = null, lease_until = null, updated_at = now()
      where id = ${input.id}
    `;
  }

  async recordEvidenceExport(input: {
    projectId: string;
    intentRowId: string;
    sha256: string;
    schemaVersion: string;
    maxEventSequence: number;
    document: unknown;
  }): Promise<EvidenceExportRecord> {
    const id = randomUUID();
    const rows = await this.sql`
      insert into evidence_exports (id, project_id, intent_row_id, evidence_sha256, schema_version, max_event_sequence, document)
      values (${id}, ${input.projectId}, ${input.intentRowId}, ${input.sha256}, ${input.schemaVersion}, ${input.maxEventSequence}, ${this.sql.json(input.document)})
      on conflict (intent_row_id, evidence_sha256) do update set document = excluded.document
      returning *
    `;
    const row = rows[0];
    if (!row) throw new Error("Evidence export insert failed");
    return {
      id: String(row.id), evidenceSha256: String(row.evidence_sha256), schemaVersion: String(row.schema_version),
      maxEventSequence: Number(row.max_event_sequence), createdAt: iso(row.created_at as Date | string),
    };
  }

  async executionPublicView(aggregate: IntentAggregate): Promise<Record<string, unknown>> {
    const snapshot: ExecutionSnapshot = {
      submissionStatus: aggregate.execution.submissionStatus,
      chainStatus: aggregate.execution.chainStatus,
      workflowStatus: aggregate.execution.workflowStatus,
      confirmationPolicy: aggregate.execution.confirmationPolicy,
      confirmationCount: aggregate.execution.confirmationCount,
      ...(aggregate.execution.committedBlockHash ? { committedBlockHash: aggregate.execution.committedBlockHash } : {}),
      ...(aggregate.execution.committedBlockNumber ? { committedBlockNumber: aggregate.execution.committedBlockNumber } : {}),
      ...(aggregate.execution.rejectionReason ? { rejectionReason: aggregate.execution.rejectionReason } : {}),
    };
    return {
      intentId: aggregate.intent.intentId,
      metadata: aggregate.intent.metadata,
      txHash: aggregate.execution.txHash,
      status: deriveOverallStatus(snapshot),
      submissionStatus: snapshot.submissionStatus,
      chainStatus: snapshot.chainStatus,
      workflowStatus: snapshot.workflowStatus,
      confirmationPolicy: snapshot.confirmationPolicy,
      confirmationCount: snapshot.confirmationCount,
      committedBlockHash: snapshot.committedBlockHash ?? null,
      committedBlockNumber: snapshot.committedBlockNumber ?? null,
      assertionStatus: aggregate.execution.assertionStatus,
      assertionResult: aggregate.execution.assertionResult,
      workflowRunId: aggregate.execution.workflowRunId,
      createdAt: aggregate.intent.createdAt,
      updatedAt: aggregate.execution.updatedAt,
    };
  }
}
