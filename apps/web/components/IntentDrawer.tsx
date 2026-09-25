"use client";

import { explorerTxUrl, formatRelativeTime, shortHash } from "../lib/browser-api.ts";
import StatusBadge from "./StatusBadge.tsx";

export interface IntentEvent {
  sequence: number;
  kind: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  occurredAt: string;
}

export interface IntentDetail {
  intentId: string;
  txHash: string | null;
  network?: string;
  status: string;
  submissionStatus: string;
  chainStatus: string;
  workflowStatus: string;
  confirmationCount: number;
  confirmationPolicy?: { mode: string; blocks?: number };
  committedBlockHash?: string | null;
  committedBlockNumber?: string | null;
  assertionStatus: string | null;
  assertionResult?: unknown;
  metadata?: Record<string, unknown>;
  expectedCells?: unknown[];
  workflowRunId?: string | null;
  createdAt: string;
  updatedAt: string;
  events?: IntentEvent[];
}

interface Props {
  detail: IntentDetail | null;
  busy: boolean;
  onClose: () => void;
  onReconcile: (intentId: string) => void;
  onEvidence: (intentId: string) => void;
}

function jsonPreview(value: unknown): string {
  if (value == null) return "—";
  return JSON.stringify(value, null, 2);
}

export default function IntentDrawer({ detail, busy, onClose, onReconcile, onEvidence }: Props) {
  if (!detail) return null;
  const required = detail.confirmationPolicy?.mode === "depth" ? detail.confirmationPolicy.blocks ?? 0 : 1;
  const percent = required > 0 ? Math.min(100, Math.round((detail.confirmationCount / required) * 100)) : 0;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="intent-drawer-title">
        <div className="drawer-header">
          <div>
            <div className="kicker">Intent detail</div>
            <h2 id="intent-drawer-title">{detail.intentId}</h2>
            <p className="mono-line">{detail.txHash ? shortHash(detail.txHash, 18, 14) : "Transaction not attached"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close intent detail">×</button>
        </div>

        <div className="drawer-actions">
          <StatusBadge value={detail.status} />
          <div className="action-cluster">
            {detail.txHash && <a className="button secondary" href={explorerTxUrl(detail.network, detail.txHash)} target="_blank" rel="noreferrer">Explorer ↗</a>}
            <button className="secondary" type="button" onClick={() => onReconcile(detail.intentId)} disabled={busy}>Reconcile</button>
            <button type="button" onClick={() => onEvidence(detail.intentId)}>Export evidence</button>
          </div>
        </div>

        <section className="drawer-section">
          <h3>Lifecycle</h3>
          <div className="triple-status">
            <div><span>Submission</span><StatusBadge value={detail.submissionStatus} compact /></div>
            <div><span>CKB</span><StatusBadge value={detail.chainStatus} compact /></div>
            <div><span>Workflow</span><StatusBadge value={detail.workflowStatus} compact /></div>
          </div>
          <div className="confirmation-card">
            <div><strong>{detail.confirmationCount}</strong><span> confirmations</span></div>
            <span>{detail.confirmationPolicy?.mode === "depth" ? `Target ${required}` : "Commit policy"}</span>
          </div>
          <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
          <dl className="detail-list">
            <div><dt>Assertion</dt><dd><StatusBadge value={detail.assertionStatus ?? "NOT_CONFIGURED"} compact /></dd></div>
            <div><dt>Committed block</dt><dd className="mono-line">{shortHash(detail.committedBlockHash)}</dd></div>
            <div><dt>Block number</dt><dd>{detail.committedBlockNumber ?? "—"}</dd></div>
            <div><dt>Last update</dt><dd>{formatRelativeTime(detail.updatedAt)}</dd></div>
          </dl>
        </section>

        <section className="drawer-section">
          <h3>Business context</h3>
          <div className="data-columns">
            <div><span className="micro-label">Metadata</span><pre className="json-box">{jsonPreview(detail.metadata ?? {})}</pre></div>
            <div><span className="micro-label">Expected Cells</span><pre className="json-box">{jsonPreview(detail.expectedCells ?? [])}</pre></div>
          </div>
        </section>

        <section className="drawer-section timeline-section">
          <div className="section-row"><h3>Audit timeline</h3><span>{detail.events?.length ?? 0} event(s)</span></div>
          <ol className="timeline">
            {(detail.events ?? []).slice().reverse().map((event) => (
              <li key={`${event.sequence}-${event.kind}`}>
                <span className="timeline-node" aria-hidden="true" />
                <div className="timeline-content">
                  <div className="section-row"><strong>{event.kind.replaceAll("_", " ")}</strong><time>{formatRelativeTime(event.occurredAt)}</time></div>
                  <div className="timeline-transition">{event.fromStatus ?? "START"} → {event.toStatus}</div>
                  {event.reason && <p>{event.reason}</p>}
                </div>
              </li>
            ))}
            {(detail.events?.length ?? 0) === 0 && <li className="timeline-empty">No state events returned yet.</li>}
          </ol>
        </section>
      </aside>
    </div>
  );
}
