"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRelativeTime, jsonRequest, shortHash } from "../lib/browser-api.ts";
import ExampleUse from "./ExampleUse.tsx";
import IntegrationsPanel from "./IntegrationsPanel.tsx";
import IntentDrawer, { type IntentDetail } from "./IntentDrawer.tsx";
import StatusBadge, { humanStatus, statusTone } from "./StatusBadge.tsx";

type Intent = {
  intentId: string;
  metadata?: Record<string, unknown>;
  txHash: string | null;
  status: string;
  submissionStatus: string;
  chainStatus: string;
  workflowStatus: string;
  confirmationPolicy?: { mode: string; blocks?: number };
  confirmationCount: number;
  assertionStatus: string | null;
  updatedAt: string;
  createdAt: string;
};

type Health = { database: "checking" | "healthy" | "down"; rpc: "checking" | "healthy" | "down"; readiness: "checking" | "healthy" | "down"; tip?: string; latencyMs?: number; };

const txHashPattern = /^0x[0-9a-fA-F]{64}$/;

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [projectName, setProjectName] = useState("CellFlow Demo");
  const [createdKey, setCreatedKey] = useState("");
  const [intents, setIntents] = useState<Intent[]>([]);
  const [serverMetrics, setServerMetrics] = useState<{ total: number; active: number; confirmed: number; attention: number } | null>(null);
  const [intentId, setIntentId] = useState("");
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("Connect a project API key to load live operational data. Keys remain only in page memory.");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [detail, setDetail] = useState<IntentDetail | null>(null);
  const [health, setHealth] = useState<Health>({ database: "checking", rpc: "checking", readiness: "checking" });
  const [showSetup, setShowSetup] = useState(false);
  const canLoad = useMemo(() => apiKey.startsWith("cf_live_"), [apiKey]);

  const loadHealth = useCallback(async () => {
    const [database, rpc, readiness] = await Promise.allSettled([
      jsonRequest<{ ok: boolean; database?: string }>("/api/health"),
      jsonRequest<{ ok: boolean; tip?: { number?: string }; latencyMs?: number }>("/api/health/rpc"),
      jsonRequest<{ ok: boolean }>("/api/ready"),
    ]);
    setHealth({
      database: database.status === "fulfilled" && database.value.ok ? "healthy" : "down",
      rpc: rpc.status === "fulfilled" && rpc.value.ok ? "healthy" : "down",
      readiness: readiness.status === "fulfilled" && readiness.value.ok ? "healthy" : "down",
      ...(rpc.status === "fulfilled" && rpc.value.tip?.number ? { tip: rpc.value.tip.number } : {}),
      ...(rpc.status === "fulfilled" && typeof rpc.value.latencyMs === "number" ? { latencyMs: rpc.value.latencyMs } : {}),
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!canLoad) return;
    if (!silent) setBusy(true);
    try {
      const [body, metricBody] = await Promise.all([
        jsonRequest<{ intents: Intent[] }>("/api/v1/intents?limit=200", apiKey),
        jsonRequest<{ metrics: { total: number; active: number; confirmed: number; attention: number } }>("/api/v1/metrics", apiKey),
      ]);
      setIntents(body.intents ?? []);
      setServerMetrics(metricBody.metrics);
      if (!silent) setMessage(`${body.intents?.length ?? 0} recent intent(s) loaded${metricBody.metrics.total > (body.intents?.length ?? 0) ? ` of ${metricBody.metrics.total} total` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load intents");
    } finally { if (!silent) setBusy(false); }
  }, [apiKey, canLoad]);

  useEffect(() => { void loadHealth(); }, [loadHealth]);
  useEffect(() => {
    if (!autoRefresh || !canLoad) return;
    const timer = window.setInterval(() => { void load(true); void loadHealth(); }, 15000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, canLoad, load, loadHealth]);

  const localMetrics = useMemo(() => ({
    total: intents.length,
    active: intents.filter((item) => !["CONFIRMED", "REJECTED", "CONFLICTED", "EXPIRED"].includes(item.status)).length,
    confirmed: intents.filter((item) => item.status === "CONFIRMED").length,
    attention: intents.filter((item) => statusTone(item.status) === "danger" || item.status === "UNKNOWN").length,
  }), [intents]);
  const metrics = serverMetrics ?? localMetrics;

  const filtered = useMemo(() => intents.filter((item) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || item.intentId.toLowerCase().includes(query) || item.txHash?.toLowerCase().includes(query) || JSON.stringify(item.metadata ?? {}).toLowerCase().includes(query);
    const matchesFilter = filter === "ALL" || (filter === "ATTENTION" ? statusTone(item.status) === "danger" || item.status === "UNKNOWN" : item.status === filter);
    return matchesSearch && matchesFilter;
  }), [filter, intents, search]);

  async function setup() {
    setBusy(true);
    try {
      const body = await jsonRequest<{ apiKey: string }>("/api/setup", undefined, { method: "POST", headers: { authorization: `Bearer ${bootstrapToken}` }, body: JSON.stringify({ name: projectName, network: "testnet" }) });
      setCreatedKey(body.apiKey); setApiKey(body.apiKey); setMessage("Project created. Copy the API key now; CellFlow stores only its hash.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Setup failed"); }
    finally { setBusy(false); }
  }

  async function track() {
    setBusy(true);
    try {
      await jsonRequest("/api/v1/intents", apiKey, { method: "POST", body: JSON.stringify({ intentId, metadata: { source: "dashboard", useCase: "manual transaction tracking" }, expectedCells: [] }) });
      await jsonRequest(`/api/v1/intents/${encodeURIComponent(intentId)}/track`, apiKey, { method: "POST", body: JSON.stringify({ txHash }) });
      setIntentId(""); setTxHash(""); await load(true); setMessage("Transaction registered and scheduled for reconciliation.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Track failed"); }
    finally { setBusy(false); }
  }

  async function reconcile(id: string) {
    setBusy(true);
    try {
      await jsonRequest(`/api/v1/intents/${encodeURIComponent(id)}/reconcile`, apiKey, { method: "POST", body: "{}" });
      await load(true); await openDetail(id, false); setMessage(`${id} reconciled.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reconcile failed"); }
    finally { setBusy(false); }
  }

  async function evidence(id: string) {
    try {
      const body = await jsonRequest<{ evidence: unknown }>(`/api/v1/intents/${encodeURIComponent(id)}/evidence`, apiKey);
      const blob = new Blob([JSON.stringify(body.evidence, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${id}-cellflow-evidence.json`; a.click(); URL.revokeObjectURL(url);
      setMessage(`Evidence exported for ${id}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Evidence export failed"); }
  }

  async function openDetail(id: string, announce = true) {
    try {
      const body = await jsonRequest<{ intent: IntentDetail }>(`/api/v1/intents/${encodeURIComponent(id)}`, apiKey);
      setDetail(body.intent); if (announce) setMessage(`Opened ${id}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Intent detail failed"); }
  }

  async function addNote(id: string, note: string) {
    setBusy(true);
    try {
      const body = await jsonRequest<{ intent: IntentDetail }>(`/api/v1/intents/${encodeURIComponent(id)}/notes`, apiKey, { method: "POST", body: JSON.stringify({ note }) });
      setDetail(body.intent);
      await load(true);
      setMessage(`Operator note added to ${id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add operator note");
      throw error;
    } finally { setBusy(false); }
  }

  return (
    <section className="shell workspace">
      <div className="control-strip panel">
        <div className="connection-copy"><span className="connection-indicator" data-connected={canLoad} /><div><strong>{canLoad ? "Project connected" : "Connect your project"}</strong><small>{canLoad ? "Live API access is active in this browser tab." : "Paste a cf_live_ API key. It is never persisted in Web Storage."}</small></div></div>
        <div className="api-key-row"><label className="sr-only" htmlFor="project-api-key">Project API key</label><input id="project-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="cf_live_…" /><button className="secondary" disabled={busy || !canLoad} onClick={() => load(false)}>Load project</button></div>
        <div className="health-cluster" aria-label="Service health">
          <span className={`health-pill health-${health.database}`}>DB <b>{health.database}</b></span>
          <span className={`health-pill health-${health.rpc}`}>CKB RPC <b>{health.rpc}</b>{health.tip ? ` · ${health.tip}` : ""}{typeof health.latencyMs === "number" ? ` · ${health.latencyMs}ms` : ""}</span>
          <span className={`health-pill health-${health.readiness}`}>Ready <b>{health.readiness}</b></span>
        </div>
      </div>

      <div className="metric-grid" aria-label="Project summary">
        <article className="metric-card"><span>Total intents</span><strong>{metrics.total}</strong><small>durable business operations</small></article>
        <article className="metric-card"><span>Active</span><strong>{metrics.active}</strong><small>still progressing or reconciling</small></article>
        <article className="metric-card metric-success"><span>Confirmed</span><strong>{metrics.confirmed}</strong><small>confirmation policy satisfied</small></article>
        <article className={`metric-card ${metrics.attention > 0 ? "metric-danger" : ""}`}><span>Needs attention</span><strong>{metrics.attention}</strong><small>unknown, rejected, conflicted or reorged</small></article>
      </div>

      <section id="operations" className="panel operations-panel" aria-labelledby="operations-title">
        <div className="section-heading">
          <div><div className="kicker">Operations</div><h2 id="operations-title">Transaction intents</h2><p>Monitor submission, CKB observation, confirmation depth and Cell assertions without collapsing them into one opaque state.</p></div>
          <div className="action-cluster"><label className="toggle"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} /><span>Auto-refresh 15s</span></label><button className="secondary" disabled={busy || !canLoad} onClick={() => load(false)}>Refresh</button></div>
        </div>

        <div className="track-card">
          <div><strong>Track an existing transaction</strong><small>Create an intent and attach a known CKB transaction hash in one dashboard action.</small></div>
          <label><span>Intent ID</span><input value={intentId} onChange={(event) => setIntentId(event.target.value)} placeholder="transfer-pass-1042" /></label>
          <label><span>Transaction hash</span><input value={txHash} onChange={(event) => setTxHash(event.target.value)} placeholder="0x…64 hex characters" /></label>
          <button disabled={busy || !canLoad || !intentId || !txHashPattern.test(txHash)} onClick={track}>Track transaction</button>
        </div>

        <div className="table-controls">
          <label className="search-field"><span className="sr-only">Search intents</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search intent, tx hash or metadata…" /></label>
          <div className="filter-row" role="group" aria-label="Filter intents">
            {["ALL", "CONFIRMED", "PENDING", "COMMITTED", "UNKNOWN", "ATTENTION"].map((value) => <button key={value} type="button" className={`filter-chip ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>{value === "ALL" ? "All" : value === "ATTENTION" ? "Attention" : humanStatus(value)}</button>)}
          </div>
          <span className="result-count">{filtered.length} shown</span>
        </div>

        <div className="notice" role="status" aria-live="polite">{message}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Intent</th><th>Overall</th><th>Lifecycle</th><th>Confirmations</th><th>Assertion</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {filtered.map((item) => {
                const target = item.confirmationPolicy?.mode === "depth" ? item.confirmationPolicy.blocks ?? 0 : 1;
                return <tr key={item.intentId}>
                  <td><button className="intent-link" type="button" onClick={() => openDetail(item.intentId)}><strong>{item.intentId}</strong><small>{item.txHash ? shortHash(item.txHash) : "No transaction attached"}</small></button></td>
                  <td><StatusBadge value={item.status} /></td>
                  <td><div className="lifecycle-cells"><span title="Submission">{humanStatus(item.submissionStatus)}</span><span aria-hidden="true">→</span><span title="CKB">{humanStatus(item.chainStatus)}</span><span aria-hidden="true">→</span><span title="Workflow">{humanStatus(item.workflowStatus)}</span></div></td>
                  <td><div className="confirmation-cell"><strong>{item.confirmationCount}</strong><span>{target ? `/ ${target}` : ""}</span></div></td>
                  <td><StatusBadge value={item.assertionStatus ?? "NOT_CONFIGURED"} compact /></td>
                  <td><span title={item.updatedAt}>{formatRelativeTime(item.updatedAt)}</span></td>
                  <td><button className="row-menu" type="button" onClick={() => openDetail(item.intentId)} aria-label={`Open ${item.intentId}`}>View →</button></td>
                </tr>;
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="empty"><strong>No matching intents</strong><span>{canLoad ? "Try another filter or track a transaction." : "Connect an API key to load project activity."}</span></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <IntegrationsPanel apiKey={apiKey} onMessage={setMessage} />
      <ExampleUse />

      <section className="panel setup-collapsible">
        <button className="setup-toggle" type="button" aria-expanded={showSetup} onClick={() => setShowSetup((value) => !value)}><span><span className="kicker">First deployment</span><strong>Bootstrap a project</strong><small>Only needed once. Disable CELLFLOW_SETUP_ENABLED afterwards.</small></span><b>{showSetup ? "Hide" : "Open setup"}</b></button>
        {showSetup && <div className="setup-body"><div className="setup-form"><label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label><span>Bootstrap token</span><input type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} placeholder="CELLFLOW_BOOTSTRAP_TOKEN" /></label><button disabled={busy || bootstrapToken.length < 24} onClick={setup}>Create project</button></div>{createdKey && <div className="one-time-secret"><span>Project API key · copy once</span><code>{createdKey}</code><button className="link-button" onClick={() => navigator.clipboard?.writeText(createdKey)}>Copy</button></div>}</div>}
      </section>

      <IntentDrawer detail={detail} busy={busy} onClose={() => setDetail(null)} onReconcile={reconcile} onEvidence={evidence} onAddNote={addNote} />
    </section>
  );
}
