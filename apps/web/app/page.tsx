import Dashboard from "../components/Dashboard.tsx";

export default function Home() {
  return (
    <main>
      <header className="topbar shell">
        <a className="brand" href="#top" aria-label="CellFlow home"><span className="brand-mark" aria-hidden="true">CF</span><span>CellFlow</span><small>v0.2</small></a>
        <nav aria-label="Primary navigation"><a href="#operations">Operations</a><a href="#integrations">Integrations</a><a href="#example">Example</a></nav>
        <span className="network-chip"><span /> CKB operations</span>
      </header>

      <section id="top" className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow">Durable CKB transaction operations</div>
          <h1>Know what happened after <em>send transaction</em>.</h1>
          <p className="lede">CellFlow turns ambiguous broadcasts, RPC outages, restarts and reorgs into an auditable lifecycle—without taking custody of keys or duplicating your application state.</p>
          <div className="hero-actions"><a className="button" href="#operations">Open operations</a><a className="button secondary" href="#example">Run the example</a></div>
          <div className="principles"><span>Non-custodial</span><span>Deterministic tx identity</span><span>Live Cell verification</span><span>Durable evidence</span></div>
        </div>
        <div className="hero-model" aria-label="CellFlow operational model">
          <div className="model-head"><span className="live-dot" />Operational model</div>
          <ol>
            <li><span>01</span><div><strong>Intent</strong><small>persist business intent</small></div></li>
            <li><span>02</span><div><strong>Identity</strong><small>hash before broadcast</small></div></li>
            <li><span>03</span><div><strong>Reconcile</strong><small>observe canonical CKB state</small></div></li>
            <li><span>04</span><div><strong>Verify</strong><small>confirm expected live Cell</small></div></li>
          </ol>
          <div className="model-foot">PostgreSQL source of truth · Vercel durable execution</div>
        </div>
      </section>

      <Dashboard />
      <footer className="shell footer"><div><strong>CellFlow</strong><span>CKB-native transaction recovery & state-transition evidence.</span></div><span>Non-custodial · application-neutral · testnet-ready</span></footer>
    </main>
  );
}
