"use client";

import { useMemo, useState } from "react";

type Intent = {
  intentId: string;
  txHash: string | null;
  status: string;
  submissionStatus: string;
  chainStatus: string;
  workflowStatus: string;
  confirmationCount: number;
  assertionStatus: string | null;
  updatedAt: string;
};

async function jsonRequest(path: string, apiKey?: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [projectName, setProjectName] = useState("CellFlow Demo");
  const [createdKey, setCreatedKey] = useState("");
  const [intents, setIntents] = useState<Intent[]>([]);
  const [intentId, setIntentId] = useState("");
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("Enter an API key to inspect a project. Keys are kept only in page memory.");
  const [busy, setBusy] = useState(false);
  const canLoad = useMemo(() => apiKey.startsWith("cf_live_"), [apiKey]);

  async function load() {
    if (!canLoad) return;
    setBusy(true);
    try {
      const body = await jsonRequest("/api/v1/intents", apiKey);
      setIntents(body.intents ?? []);
      setMessage(`${body.intents?.length ?? 0} intent(s) loaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load intents");
    } finally {
      setBusy(false);
    }
  }

  async function setup() {
    setBusy(true);
    try {
      const body = await jsonRequest("/api/setup", undefined, {
        method: "POST",
        headers: { authorization: `Bearer ${bootstrapToken}` },
        body: JSON.stringify({ name: projectName, network: "testnet" }),
      });
      setCreatedKey(body.apiKey);
      setApiKey(body.apiKey);
      setMessage("Project created. Copy the API key now; CellFlow stores only its hash.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function track() {
    setBusy(true);
    try {
      await jsonRequest("/api/v1/intents", apiKey, {
        method: "POST",
        body: JSON.stringify({ intentId, metadata: { source: "dashboard" }, expectedCells: [] }),
      });
      await jsonRequest(`/api/v1/intents/${encodeURIComponent(intentId)}/track`, apiKey, {
        method: "POST",
        body: JSON.stringify({ txHash }),
      });
      setIntentId("");
      setTxHash("");
      await load();
      setMessage("Transaction registered and scheduled for reconciliation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Track failed");
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(id: string) {
    setBusy(true);
    try {
      await jsonRequest(`/api/v1/intents/${encodeURIComponent(id)}/reconcile`, apiKey, { method: "POST", body: "{}" });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reconcile failed");
    } finally {
      setBusy(false);
    }
  }

  async function evidence(id: string) {
    try {
      const body = await jsonRequest(`/api/v1/intents/${encodeURIComponent(id)}/evidence`, apiKey);
      const blob = new Blob([JSON.stringify(body.evidence, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}-cellflow-evidence.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evidence export failed");
    }
  }

  return (
    <section className="shell workspace">
      <div className="panel setup-panel">
        <div>
          <div className="kicker">First deploy</div>
          <h2>Create a project</h2>
          <p>Use the dedicated bootstrap token. The encryption key never enters the browser. Disable setup in production after provisioning.</p>
        </div>
        <div className="form-grid">
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" />
          <input type="password" value={bootstrapToken} onChange={(e) => setBootstrapToken(e.target.value)} placeholder="CELLFLOW_BOOTSTRAP_TOKEN" />
          <button disabled={busy || bootstrapToken.length < 24} onClick={setup}>Create project</button>
        </div>
        {createdKey && <code className="secret">{createdKey}</code>}
      </div>

      <div className="panel">
        <div className="toolbar">
          <div><div className="kicker">Operations</div><h2>Intent dashboard</h2></div>
          <div className="api-key-row">
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="cf_live_…" />
            <button className="secondary" disabled={busy || !canLoad} onClick={load}>Refresh</button>
          </div>
        </div>

        <div className="track-row">
          <input value={intentId} onChange={(e) => setIntentId(e.target.value)} placeholder="intent id, e.g. transfer-pass-1042" />
          <input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x… transaction hash" />
          <button disabled={busy || !intentId || !/^0x[0-9a-fA-F]{64}$/.test(txHash)} onClick={track}>Track</button>
        </div>

        <div className="notice">{message}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Intent</th><th>Overall</th><th>Submission</th><th>CKB</th><th>Workflow</th><th>Conf.</th><th>Actions</th></tr></thead>
            <tbody>
              {intents.map((item) => (
                <tr key={item.intentId}>
                  <td><strong>{item.intentId}</strong><small>{item.txHash ? `${item.txHash.slice(0, 10)}…${item.txHash.slice(-8)}` : "No tx yet"}</small></td>
                  <td><span className={`status status-${item.status.toLowerCase()}`}>{item.status}</span></td>
                  <td>{item.submissionStatus}</td><td>{item.chainStatus}</td><td>{item.workflowStatus}</td>
                  <td>{item.confirmationCount}</td>
                  <td className="actions"><button className="link" onClick={() => reconcile(item.intentId)}>Reconcile</button><button className="link" onClick={() => evidence(item.intentId)}>Evidence</button></td>
                </tr>
              ))}
              {intents.length === 0 && <tr><td colSpan={7} className="empty">No intents loaded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
