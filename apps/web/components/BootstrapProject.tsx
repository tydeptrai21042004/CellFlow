"use client";

import { useState } from "react";
import { jsonRequest } from "../lib/browser-api.ts";

export default function BootstrapProject() {
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [projectName, setProjectName] = useState("");
  const [network, setNetwork] = useState("testnet");
  const [createdKey, setCreatedKey] = useState("");
  const [message, setMessage] = useState("Use this surface only for initial project provisioning. Disable setup immediately afterwards.");
  const [busy, setBusy] = useState(false);

  async function setup() {
    setBusy(true);
    try {
      const body = await jsonRequest<{ apiKey: string }>("/api/setup", undefined, {
        method: "POST",
        headers: { authorization: `Bearer ${bootstrapToken}` },
        body: JSON.stringify({ name: projectName.trim(), network }),
      });
      setCreatedKey(body.apiKey);
      setMessage("Project created. Copy the API key now; CellFlow stores only its hash.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="provisioning-card" aria-labelledby="provisioning-title">
      <div className="provisioning-warning">
        <span>One-time administrative operation</span>
        <strong>Provision the first project, then set <code>CELLFLOW_SETUP_ENABLED=false</code>.</strong>
        <p>Do not leave bootstrap setup exposed in a production deployment. Project API keys should be created and rotated from the authenticated console after this step.</p>
      </div>

      <div className="provisioning-form">
        <div className="section-intro compact">
          <span className="kicker">Initial provisioning</span>
          <h2 id="provisioning-title">Create the first CellFlow project</h2>
          <p>This calls the guarded bootstrap endpoint. The returned API key is shown once.</p>
        </div>
        <label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Production application" /></label>
        <label><span>CKB network</span><select value={network} onChange={(event) => setNetwork(event.target.value)}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select></label>
        <label><span>Bootstrap token</span><input type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} placeholder="CELLFLOW_BOOTSTRAP_TOKEN" /></label>
        <button type="button" disabled={busy || projectName.trim().length < 2 || bootstrapToken.length < 24} onClick={setup}>{busy ? "Provisioning…" : "Create project"}</button>
        <div className="notice" role="status" aria-live="polite">{message}</div>
        {createdKey && <div className="one-time-secret provisioning-secret"><span>Project API key · copy once</span><code>{createdKey}</code><button className="link-button" type="button" onClick={() => navigator.clipboard?.writeText(createdKey)}>Copy</button></div>}
      </div>
    </section>
  );
}
