import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { deriveOverallStatus, type ConfirmationPolicy, type ExecutionSnapshot } from "@cellflow/core";
import { getSql } from "./client.js";
import type {
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
    createdAt: iso(row.created_at as Date | string),
    updatedAt: iso(row.updated_at as Date | string),
  };
}

export class CellFlowRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async ping(): Promise<boolean> {
    const rows = await this.sql`select 1 as ok`;
    return Number(rows[0]?.ok) === 1;
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

  async createIntent(input: {
    project: ProjectRecord;
    intentId: string;
    metadata: Record<string, unknown>;
    expectedCells: unknown[];
    txHash?: string | null;
    submissionStatus?: ExecutionRecord["submissionStatus"];
  }): Promise<{ aggregate: IntentAggregate; created: boolean }> {
    return this.sql.begin(async (tx) => {
      const intentRowId = randomUUID();
      const inserted = await tx`
        insert into intents (id, project_id, intent_id, metadata, expected_cells)
        values (
          ${intentRowId}, ${input.project.id}, ${input.intentId},
          ${tx.json(input.metadata)}, ${tx.json(input.expectedCells)}
        )
        on conflict (project_id, intent_id) do nothing
        returning *
      `;

      let intentRow = inserted[0];
      let created = true;
      if (!intentRow) {
        created = false;
        const existing = await tx`
          select * from intents where project_id = ${input.project.id} and intent_id = ${input.intentId} limit 1
        `;
        intentRow = existing[0];
      }
      if (!intentRow) throw new Error("Intent upsert failed");

      if (created) {
        await tx`
          insert into executions (
            id, project_id, intent_row_id, tx_hash, network,
            submission_status, chain_status, workflow_status, confirmation_policy,
            next_reconcile_at
          ) values (
            ${randomUUID()}, ${input.project.id}, ${String(intentRow.id)}, ${input.txHash ?? null}, ${input.project.network},
            ${input.submissionStatus ?? (input.txHash ? "SUBMITTED" : "NOT_SUBMITTED")},
            'UNOBSERVED', 'IDLE', ${tx.json(input.project.confirmationPolicy)},
            ${input.txHash ? new Date() : null}
          )
        `;
      }

      const executionRows = await tx`
        select * from executions where intent_row_id = ${String(intentRow.id)} limit 1
      `;
      const executionRow = executionRows[0];
      if (!executionRow) throw new Error("Execution missing for intent");

      return {
        created,
        aggregate: {
          intent: mapIntent(intentRow),
          execution: mapExecution(executionRow),
        },
      };
    });
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
        id: row.i_id,
        project_id: row.i_project_id,
        intent_id: row.i_intent_id,
        metadata: row.i_metadata,
        expected_cells: row.i_expected_cells,
        created_at: row.i_created_at,
        updated_at: row.i_updated_at,
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
        id: row.i_id,
        project_id: row.i_project_id,
        intent_id: row.i_intent_id,
        metadata: row.i_metadata,
        expected_cells: row.i_expected_cells,
        created_at: row.i_created_at,
        updated_at: row.i_updated_at,
      }),
      execution: mapExecution(row),
    }));
  }

  async attachTransaction(input: {
    projectId: string;
    intentId: string;
    txHash: string;
    submissionStatus: ExecutionRecord["submissionStatus"];
    nextReconcileAt?: Date | null;
  }): Promise<IntentAggregate | null> {
    const aggregate = await this.getIntent(input.projectId, input.intentId);
    if (!aggregate) return null;
    if (aggregate.execution.txHash && aggregate.execution.txHash !== input.txHash) {
      throw new Error("INTENT_TX_CONFLICT");
    }
    await this.sql`
      update executions
      set tx_hash = ${input.txHash}, submission_status = ${input.submissionStatus},
          next_reconcile_at = ${input.nextReconcileAt ?? new Date()},
          version = version + 1, updated_at = now()
      where id = ${aggregate.execution.id} and project_id = ${input.projectId}
    `;
    return this.getIntent(input.projectId, input.intentId);
  }

  async markSubmissionStatus(input: {
    projectId: string;
    intentId: string;
    status: ExecutionRecord["submissionStatus"];
    scheduleReconcile?: boolean;
  }): Promise<IntentAggregate | null> {
    const aggregate = await this.getIntent(input.projectId, input.intentId);
    if (!aggregate) return null;
    await this.sql`
      update executions
      set submission_status = ${input.status},
          next_reconcile_at = ${input.scheduleReconcile ? new Date() : aggregate.execution.nextReconcileAt},
          version = version + 1, updated_at = now()
      where id = ${aggregate.execution.id} and project_id = ${input.projectId}
    `;
    return this.getIntent(input.projectId, input.intentId);
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
          assertion_status = ${input.assertionStatus ?? input.aggregate.execution.assertionStatus},
          assertion_result = ${input.assertionResult === undefined ? input.aggregate.execution.assertionResult : tx.json(input.assertionResult)},
          last_raw_observation = ${input.event.rawObservation === undefined ? input.aggregate.execution.lastRawObservation : tx.json(input.event.rawObservation)},
          last_observed_at = ${input.event.rawObservation === undefined ? input.aggregate.execution.lastObservedAt : new Date(input.event.occurredAt)},
          next_reconcile_at = ${input.nextReconcileAt},
          reconcile_attempts = reconcile_attempts + 1,
          version = version + 1,
          updated_at = now()
        where id = ${input.aggregate.execution.id}
          and project_id = ${input.aggregate.intent.projectId}
          and version = ${input.aggregate.execution.version}
        returning id
      `;
      if (updated.length !== 1) return null;
      const eventId = randomUUID();
      await tx`
        insert into state_events (
          id, project_id, intent_row_id, execution_id, kind,
          from_status, to_status, reason, raw_observation, occurred_at
        ) values (
          ${eventId}, ${input.aggregate.intent.projectId}, ${input.aggregate.intent.id}, ${input.aggregate.execution.id}, ${input.event.kind},
          ${input.event.fromStatus}, ${input.event.toStatus}, ${input.event.reason ?? null},
          ${input.event.rawObservation === undefined ? null : tx.json(input.event.rawObservation)}, ${new Date(input.event.occurredAt)}
        )
      `;
      await tx`update intents set updated_at = now() where id = ${input.aggregate.intent.id}`;
      return eventId;
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
    const id = randomUUID();
    await this.sql`
      insert into state_events (
        id, project_id, intent_row_id, execution_id, kind,
        from_status, to_status, reason, raw_observation, occurred_at
      ) values (
        ${id}, ${input.aggregate.intent.projectId}, ${input.aggregate.intent.id}, ${input.aggregate.execution.id}, ${input.kind},
        ${input.fromStatus}, ${input.toStatus}, ${input.reason ?? null},
        ${input.rawObservation === undefined ? null : this.sql.json(input.rawObservation)}, now()
      )
    `;
    return id;
  }

  async getEvents(projectId: string, intentRowId: string): Promise<StateEventRecord[]> {
    const rows = await this.sql`
      select sequence, id, kind, from_status, to_status, reason, raw_observation, occurred_at
      from state_events
      where project_id = ${projectId} and intent_row_id = ${intentRowId}
      order by sequence asc
    `;
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      id: String(row.id),
      kind: String(row.kind),
      fromStatus: row.from_status ? String(row.from_status) : null,
      toStatus: String(row.to_status),
      reason: row.reason ? String(row.reason) : null,
      rawObservation: row.raw_observation ?? null,
      occurredAt: iso(row.occurred_at as Date | string),
    }));
  }

  async listDueExecutions(limit = 25): Promise<IntentAggregate[]> {
    const rows = await this.sql`
      select i.project_id, i.intent_id
      from executions e join intents i on i.id = e.intent_row_id
      where e.next_reconcile_at is not null and e.next_reconcile_at <= now()
        and e.workflow_status not in ('CONFLICTED', 'EXPIRED')
        and e.chain_status <> 'REJECTED'
      order by e.next_reconcile_at asc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
    const result: IntentAggregate[] = [];
    for (const row of rows) {
      const aggregate = await this.getIntent(String(row.project_id), String(row.intent_id));
      if (aggregate) result.push(aggregate);
    }
    return result;
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const rows = await this.sql`select * from projects where id = ${projectId} limit 1`;
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async createWebhookEndpoint(input: {
    projectId: string;
    url: string;
    signingSecretEncrypted: string;
  }): Promise<WebhookEndpointRecord> {
    const id = randomUUID();
    const rows = await this.sql`
      insert into webhook_endpoints (id, project_id, url, signing_secret_encrypted)
      values (${id}, ${input.projectId}, ${input.url}, ${input.signingSecretEncrypted})
      on conflict (project_id, url) do update set
        signing_secret_encrypted = excluded.signing_secret_encrypted,
        enabled = true,
        secret_version = webhook_endpoints.secret_version + 1,
        updated_at = now()
      returning *
    `;
    const row = rows[0];
    if (!row) throw new Error("Webhook endpoint creation failed");
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      url: String(row.url),
      signingSecretEncrypted: String(row.signing_secret_encrypted),
      secretVersion: Number(row.secret_version),
      enabled: Boolean(row.enabled),
    };
  }

  async listWebhookEndpoints(projectId: string): Promise<WebhookEndpointRecord[]> {
    const rows = await this.sql`
      select * from webhook_endpoints where project_id = ${projectId} and enabled = true order by created_at asc
    `;
    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      url: String(row.url),
      signingSecretEncrypted: String(row.signing_secret_encrypted),
      secretVersion: Number(row.secret_version),
      enabled: Boolean(row.enabled),
    }));
  }

  async enqueueWebhookDeliveries(input: {
    projectId: string;
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<number> {
    const endpoints = await this.listWebhookEndpoints(input.projectId);
    let count = 0;
    for (const endpoint of endpoints) {
      const result = await this.sql`
        insert into webhook_deliveries (
          id, project_id, endpoint_id, event_id, event_type, payload, next_attempt_at
        ) values (
          ${randomUUID()}, ${input.projectId}, ${endpoint.id}, ${input.eventId}, ${input.eventType}, ${this.sql.json(input.payload)}, now()
        )
        on conflict (endpoint_id, event_id) do nothing
        returning id
      `;
      count += result.length;
    }
    return count;
  }

  async listDueWebhookDeliveries(limit = 25): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.sql`
      select * from webhook_deliveries
      where status in ('PENDING', 'RETRY') and next_attempt_at <= now()
      order by next_attempt_at asc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      endpointId: String(row.endpoint_id),
      eventId: String(row.event_id),
      eventType: String(row.event_type),
      payload: row.payload,
      attemptCount: Number(row.attempt_count),
      status: String(row.status),
      nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at as Date | string) : null,
    }));
  }

  async getWebhookEndpoint(projectId: string, endpointId: string): Promise<WebhookEndpointRecord | null> {
    const rows = await this.sql`
      select * from webhook_endpoints where project_id = ${projectId} and id = ${endpointId} limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      url: String(row.url),
      signingSecretEncrypted: String(row.signing_secret_encrypted),
      secretVersion: Number(row.secret_version),
      enabled: Boolean(row.enabled),
    };
  }

  async completeWebhookDelivery(input: {
    id: string;
    success: boolean;
    responseStatus?: number;
    error?: string;
    retryAt?: Date;
  }): Promise<void> {
    await this.sql`
      update webhook_deliveries set
        attempt_count = attempt_count + 1,
        status = ${input.success ? "DELIVERED" : input.retryAt ? "RETRY" : "FAILED"},
        response_status = ${input.responseStatus ?? null},
        last_error = ${input.error ?? null},
        next_attempt_at = ${input.retryAt ?? null},
        delivered_at = ${input.success ? new Date() : null},
        updated_at = now()
      where id = ${input.id}
    `;
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
      createdAt: aggregate.intent.createdAt,
      updatedAt: aggregate.execution.updatedAt,
    };
  }
}
