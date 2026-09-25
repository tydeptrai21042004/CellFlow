import Dashboard from "../components/Dashboard.tsx";

export default function Home() {
  return (
    <main>
      <section className="hero shell">
        <div className="eyebrow">CKB transaction operations layer</div>
        <h1>Make ambiguous CKB transaction outcomes recoverable.</h1>
        <p className="lede">
          CellFlow persists business intent before broadcast, reconciles CKB lifecycle after restarts and RPC timeouts,
          tracks confirmation depth and reorgs, verifies expected Cells, and emits signed webhooks.
        </p>
        <div className="principles">
          <span>Non-custodial</span><span>CCC-native</span><span>Postgres durable</span><span>Vercel ready</span>
        </div>
      </section>
      <Dashboard />
      <footer className="shell footer">CellFlow v0.1 · CKB-native execution recovery, not a wallet or indexer.</footer>
    </main>
  );
}
