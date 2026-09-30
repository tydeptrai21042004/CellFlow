"use client";

import { useState } from "react";
import { jsonRequest } from "../lib/browser-api.ts";

type SetupResponse = {
  apiKey: string;
  initialization?: {
    schemaReady: boolean;
    latestMigration: string | null;
    migrationsApplied: string[];
    bootstrapLocked: boolean;
  };
};

export default function BootstrapProject() {
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [projectName, setProjectName] = useState("");
  const [network, setNetwork] = useState("testnet");
  const [createdKey, setCreatedKey] = useState("");
  const [message, setMessage] = useState("Enter the bootstrap token once. CellFlow will initialize the database schema and permanently close first-project bootstrap after success.");
  const [busy, setBusy] = useState(false);

  async function setup() {
    setBusy(true);
    try {
      const body = await jsonRequest<SetupResponse>("/api/setup", undefined, {
        method: "POST",
        headers: { authorization: `Bearer ${bootstrapToken}` },
        body: JSON.stringify({ name: projectName.trim(), network }),
      });
      setCreatedKey(body.apiKey);
      const applied = body.initialization?.migrationsApplied.length ?? 0;
      setMessage(
        `Project created. Database ready${applied > 0 ? ` (${applied} migration${applied === 1 ? "" : "s"} applied)` : ""}; bootstrap is now locked. Copy the API key now—CellFlow stores only its hash.`,
      );
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
        <strong>Schema initialization and bootstrap locking are automatic.</strong>
        <p>A valid bootstrap token is required. On the first successful request CellFlow applies pending database migrations, creates the first project, returns its admin API key once, and blocks subsequent bootstrap attempts using durable database state.</p>
      </div>

      <div className="provisioning-form">
        <div className="section-intro compact">
          <span className="kicker">Initial provisioning</span>
          <h2 id="provisioning-title">Initialize CellFlow and create the first project</h2>
          <p>No manual SQL migration or post-setup environment toggle is required.</p>
        </div>
        <label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Production application" /></label>
        <label><span>CKB network</span><select value={network} onChange={(event) => setNetwork(event.target.value)}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select></label>
        <label><span>Bootstrap token</span><input type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} placeholder="CELLFLOW_BOOTSTRAP_TOKEN" /></label>
        <button type="button" disabled={busy || projectName.trim().length < 2 || bootstrapToken.length < 24} onClick={setup}>{busy ? "Initializing…" : "Initialize & create project"}</button>
        <div className="notice" role="status" aria-live="polite">{message}</div>
        {createdKey && <div className="one-time-secret provisioning-secret"><span>Project API key · copy once</span><code>{createdKey}</code><button className="link-button" type="button" onClick={() => navigator.clipboard?.writeText(createdKey)}>Copy</button></div>}
      </div>
    </section>
  );
}
