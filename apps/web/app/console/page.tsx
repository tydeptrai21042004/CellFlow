import type { Metadata } from "next";
import ProductHeader from "../../components/ProductHeader.tsx";
import Dashboard from "../../components/Dashboard.tsx";

export const metadata: Metadata = {
  title: "CellFlow Console — Live CKB Operations",
  description: "Operate CellFlow projects: inspect transaction intents, reconcile ambiguous submissions, export evidence and manage integrations.",
};

export default function ConsolePage() {
  return (
    <main className="console-page">
      <ProductHeader active="console" />
      <section className="console-heading shell">
        <div>
          <div className="eyebrow">Operator workspace</div>
          <h1>Production console</h1>
          <p>Connect a project key to inspect transaction state, reconcile ambiguous operations, verify evidence, and manage delivery integrations.</p>
        </div>
        <div className="console-mode"><span className="live-dot" /><div><strong>Live project data</strong><small>No demo state is rendered on this route</small></div></div>
      </section>
      <nav className="console-subnav shell" aria-label="Console sections">
        <a href="#operations">Transactions</a>
        <a href="#integrations">Keys & webhooks</a>
        <a href="/console/setup">Initial setup</a>
        <a href="/demo">Demo ↗</a>
      </nav>
      <Dashboard />
      <footer className="shell footer console-footer"><div><strong>CellFlow Console</strong><span>Project credentials remain in page memory only.</span></div><span>Use scoped, expiring API keys for operator access.</span></footer>
    </main>
  );
}
