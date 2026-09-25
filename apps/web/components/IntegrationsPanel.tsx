"use client";

import { useState } from "react";
import { jsonRequest } from "../lib/browser-api.ts";

interface ApiKeyRecord { id: string; prefix: string; label: string; scopes: string[]; expiresAt?: string | null; createdAt?: string; lastUsedAt?: string | null; revokedAt?: string | null; }
interface WebhookRecord { id: string; url: string; secretVersion: number; enabled: boolean; deliveredCount: number; failedCount: number; pendingCount: number; lastDeliveryAt: string | null; }

export default function IntegrationsPanel({ apiKey, onMessage }: { apiKey: string; onMessage: (message: string) => void }) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
  const [label, setLabel] = useState("deploy-bot");
  const [newKey, setNewKey] = useState("");
  const [keyProfile, setKeyProfile] = useState<"runtime" | "readonly" | "admin">("runtime");
  const [keyExpiryDays, setKeyExpiryDays] = useState("90");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!apiKey) return;
    setBusy(true);
    try {
      const [keyBody, webhookBody] = await Promise.all([
        jsonRequest<{ keys: ApiKeyRecord[] }>("/api/v1/api-keys", apiKey),
        jsonRequest<{ webhooks: WebhookRecord[] }>("/api/v1/webhooks", apiKey),
      ]);
      setKeys(keyBody.keys ?? []);
      setWebhooks(webhookBody.webhooks ?? []);
      onMessage("Integration settings refreshed.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Integration refresh failed");
    } finally { setBusy(false); }
  }

  async function createKey() {
    setBusy(true);
    try {
      const scopes = keyProfile === "admin" ? ["read", "write", "admin"] : keyProfile === "readonly" ? ["read"] : ["read", "write"];
      const expiresInDays = Number(keyExpiryDays);
      const body = await jsonRequest<{ key: { apiKey: string } }>("/api/v1/api-keys", apiKey, {
        method: "POST",
        body: JSON.stringify({ label, scopes, expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : 90 }),
      });
      setNewKey(body.key.apiKey);
      await refresh();
      onMessage("API key created. Copy it now; only its hash is stored.");
    } catch (error) { onMessage(error instanceof Error ? error.message : "API key creation failed"); }
    finally { setBusy(false); }
  }

  async function revokeKey(keyId: string) {
    setBusy(true);
    try {
      await jsonRequest(`/api/v1/api-keys/${encodeURIComponent(keyId)}`, apiKey, { method: "DELETE" });
      await refresh();
      onMessage("API key revoked.");
    } catch (error) { onMessage(error instanceof Error ? error.message : "API key revocation failed"); }
    finally { setBusy(false); }
  }

  async function createWebhook() {
    setBusy(true);
    try {
      const body = await jsonRequest<{ webhook: { signingSecret: string } }>("/api/v1/webhooks", apiKey, { method: "POST", body: JSON.stringify({ url: webhookUrl }) });
      setNewWebhookSecret(body.webhook.signingSecret);
      setWebhookUrl("");
      await refresh();
      onMessage("Webhook endpoint created. Copy the signing secret now.");
    } catch (error) { onMessage(error instanceof Error ? error.message : "Webhook creation failed"); }
    finally { setBusy(false); }
  }

  async function testWebhook() {
    setBusy(true);
    try {
      const body = await jsonRequest<{ queued: number }>("/api/v1/webhooks/test", apiKey, { method: "POST", body: "{}" });
      onMessage(`Webhook test accepted (${body.queued ?? 0} delivery record(s) queued).`);
      await refresh();
    } catch (error) { onMessage(error instanceof Error ? error.message : "Webhook test failed"); }
    finally { setBusy(false); }
  }

  async function retryFailedWebhooks(endpointId?: string) {
    setBusy(true);
    try {
      const body = await jsonRequest<{ retried: number }>("/api/v1/webhooks/retry", apiKey, {
        method: "POST",
        body: JSON.stringify(endpointId ? { endpointId } : {}),
      });
      await refresh();
      onMessage(`${body.retried ?? 0} failed webhook delivery record(s) queued for retry.`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "Webhook retry failed"); }
    finally { setBusy(false); }
  }

  async function disableWebhook(endpointId: string) {
    setBusy(true);
    try {
      await jsonRequest(`/api/v1/webhooks/${encodeURIComponent(endpointId)}`, apiKey, { method: "DELETE" });
      await refresh();
      onMessage("Webhook endpoint disabled. Re-adding the same URL rotates its signing secret and enables it again.");
    } catch (error) { onMessage(error instanceof Error ? error.message : "Webhook disable failed"); }
    finally { setBusy(false); }
  }

  return (
    <section id="integrations" className="panel integrations-panel">
      <div className="section-heading">
        <div><div className="kicker">Integrations</div><h2>Keys & webhooks</h2><p>Keep service credentials short-lived in your operational workflow and verify webhook delivery before depending on it.</p></div>
        <button className="secondary" type="button" disabled={busy || !apiKey} onClick={refresh}>Refresh settings</button>
      </div>
      <div className="integration-grid">
        <div className="subpanel">
          <div className="section-row"><h3>API keys</h3><span>{keys.length} listed</span></div>
          <div className="stacked-form">
            <label><span>Label</span><input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
            <div className="inline-form">
              <label><span>Access profile</span><select value={keyProfile} onChange={(event) => setKeyProfile(event.target.value as "runtime" | "readonly" | "admin")}><option value="runtime">Runtime · read/write</option><option value="readonly">Read-only</option><option value="admin">Admin</option></select></label>
              <label><span>Expires (days)</span><input inputMode="numeric" value={keyExpiryDays} onChange={(event) => setKeyExpiryDays(event.target.value)} /></label>
              <button type="button" disabled={busy || !apiKey || label.trim().length < 2 || Number(keyExpiryDays) < 1 || Number(keyExpiryDays) > 365} onClick={createKey}>Create key</button>
            </div>
          </div>
          {newKey && <div className="one-time-secret"><span>Copy once</span><code>{newKey}</code><button className="link-button" type="button" onClick={() => navigator.clipboard?.writeText(newKey)}>Copy</button></div>}
          <div className="compact-list">
            {keys.map((key) => {
              const current = apiKey.startsWith(key.prefix);
              const revoked = Boolean(key.revokedAt);
              return <div key={key.id}><div><strong>{key.label}{current ? " · current" : ""}</strong><small>{key.prefix}… · {(key.scopes ?? []).join("/") || "legacy"}{key.expiresAt ? ` · expires ${new Date(key.expiresAt).toLocaleDateString()}` : " · no expiry"}{revoked ? " · revoked" : key.lastUsedAt ? " · used" : " · never used"}</small></div><button className="danger-link" type="button" disabled={revoked || current} title={current ? "Switch to another key before revoking this one" : undefined} onClick={() => revokeKey(key.id)}>{revoked ? "Revoked" : current ? "In use" : "Revoke"}</button></div>;
            })}
            {keys.length === 0 && <p className="muted-empty">Connect with an API key and refresh to manage keys.</p>}
          </div>
        </div>
        <div className="subpanel">
          <div className="section-row"><h3>Signed webhooks</h3><span>{webhooks.length} endpoint(s)</span></div>
          <div className="stacked-form"><label><span>HTTPS endpoint</span><input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://api.example.com/cellflow" /></label><div className="action-cluster"><button type="button" disabled={busy || !apiKey || !webhookUrl.startsWith("https://")} onClick={createWebhook}>Add endpoint</button><button className="secondary" type="button" disabled={busy || !apiKey || webhooks.length === 0} onClick={testWebhook}>Send test</button><button className="secondary" type="button" disabled={busy || !apiKey || !webhooks.some((item) => item.failedCount > 0)} onClick={() => retryFailedWebhooks()}>Retry failed</button></div></div>
          {newWebhookSecret && <div className="one-time-secret"><span>Signing secret</span><code>{newWebhookSecret}</code><button className="link-button" type="button" onClick={() => navigator.clipboard?.writeText(newWebhookSecret)}>Copy</button></div>}
          <div className="compact-list">
            {webhooks.map((webhook) => <div key={webhook.id}><div><strong>{webhook.url}</strong><small>Secret v{webhook.secretVersion} · {webhook.deliveredCount} delivered · {webhook.pendingCount} pending · {webhook.failedCount} failed</small></div><div className="endpoint-actions"><span className={`endpoint-state ${webhook.enabled ? "" : "endpoint-disabled"}`}>{webhook.enabled ? "Active" : "Disabled"}</span>{webhook.failedCount > 0 && <button className="link-button" type="button" disabled={busy} onClick={() => retryFailedWebhooks(webhook.id)}>Retry failed</button>}{webhook.enabled && <button className="danger-link" type="button" disabled={busy} onClick={() => disableWebhook(webhook.id)}>Disable</button>}</div></div>)}
            {webhooks.length === 0 && <p className="muted-empty">No webhook endpoints loaded.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
