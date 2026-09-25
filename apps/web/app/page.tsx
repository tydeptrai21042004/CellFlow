import type { Metadata } from "next";
import Link from "next/link";
import ProductHeader from "../components/ProductHeader.tsx";

const capabilities = [
  ["Ambiguous submission recovery", "A timeout is treated as uncertainty. CellFlow reconciles by deterministic transaction hash before any retry decision."],
  ["Canonical chain observation", "Track pending, committed, confirmed, rejected and reorged states without collapsing chain state into one application flag."],
  ["Expected Cell verification", "Verify the output you expected is live and matches the lock, type and data assertions your application depends on."],
  ["Auditable operations", "Persist lifecycle events, operator notes, delivery history and portable evidence for incident review or external verification."],
] as const;

export const metadata: Metadata = {
  title: "CellFlow — Durable CKB Transaction Operations",
  description: "Non-custodial CKB transaction recovery, reconciliation, live Cell verification and auditable operations.",
};

export default function Home() {
  return (
    <main>
      <ProductHeader active="home" />

      <section className="landing-hero shell">
        <div className="landing-copy">
          <div className="eyebrow">CKB transaction operations infrastructure</div>
          <h1>Make transaction uncertainty <em>operationally manageable.</em></h1>
          <p className="lede">CellFlow is a non-custodial control plane for CKB applications. Persist transaction identity before broadcast, recover through RPC ambiguity, observe canonical state, and verify the live Cell your application actually depends on.</p>
          <div className="hero-actions">
            <Link className="button" href="/console">Open production console</Link>
            <Link className="button secondary" href="/demo">Explore the isolated demo</Link>
          </div>
          <div className="trust-row" aria-label="Product properties">
            <span>Non-custodial</span><span>Application-neutral</span><span>PostgreSQL-backed</span><span>Signed webhooks</span><span>CKB-native verification</span>
          </div>
        </div>
        <div className="landing-diagram" aria-label="CellFlow lifecycle">
          <div className="diagram-label"><span className="live-dot" /> Durable lifecycle</div>
          <div className="diagram-stage"><b>01</b><div><strong>Persist intent</strong><span>business operation exists before network side effects</span></div></div>
          <div className="diagram-stage"><b>02</b><div><strong>Persist tx identity</strong><span>deterministic hash is known before broadcast</span></div></div>
          <div className="diagram-stage"><b>03</b><div><strong>Reconcile CKB</strong><span>timeouts and restarts resume from durable state</span></div></div>
          <div className="diagram-stage"><b>04</b><div><strong>Verify live Cell</strong><span>settlement requires the expected chain state</span></div></div>
        </div>
      </section>

      <section className="landing-section shell">
        <div className="section-intro">
          <span className="kicker">What it solves</span>
          <h2>Built for the part after <code>send_transaction</code>.</h2>
          <p>CellFlow does not replace wallets, RPC providers or your domain database. It owns the operational lifecycle between a signed CKB transaction and the final state your application is willing to trust.</p>
        </div>
        <div className="capability-grid">
          {capabilities.map(([title, copy], index) => (
            <article className="capability-card" key={title}>
              <span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section shell product-boundary">
        <div>
          <span className="kicker">Clear product boundary</span>
          <h2>Operational truth, not another application database.</h2>
        </div>
        <div className="boundary-grid">
          <article><strong>CellFlow owns</strong><p>Intent lifecycle, transaction identity, observations, confirmation state, expected-Cell assertions, audit events and webhook delivery.</p></article>
          <article><strong>Your app owns</strong><p>Users, orders, entitlements, balances, business permissions and signing keys. CellFlow references those operations without taking custody of them.</p></article>
        </div>
      </section>

      <section className="landing-section shell deployment-strip">
        <div><span className="kicker">Production candidate</span><h2>Separate operator console and safe demo surface.</h2><p>The real console accepts project credentials and exposes operational controls. The demo is isolated, local-only and cannot be mistaken for live CKB activity.</p></div>
        <div className="deployment-actions"><Link className="button" href="/console">Launch console</Link><Link className="button secondary" href="/demo">Run demo</Link></div>
      </section>

      <footer className="shell landing-footer"><div><strong>CellFlow</strong><span>CKB-native durable transaction operations.</span></div><span>Non-custodial · auditable · testnet-oriented production candidate</span></footer>
    </main>
  );
}
