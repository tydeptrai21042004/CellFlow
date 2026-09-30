import type { Metadata } from "next";
import Link from "next/link";
import BootstrapProject from "../../../components/BootstrapProject.tsx";
import ProductHeader from "../../../components/ProductHeader.tsx";

export const metadata: Metadata = {
  title: "CellFlow Setup — Automatic Project Bootstrap",
  description: "One-time CellFlow provisioning with automatic database migrations and durable bootstrap locking.",
};

export default function SetupPage() {
  return (
    <main className="console-page setup-page">
      <ProductHeader active="console" />
      <section className="console-heading shell">
        <div>
          <div className="eyebrow">Deployment administration</div>
          <h1>Project bootstrap</h1>
          <p>Provide the server bootstrap token once. CellFlow initializes the database schema, provisions the first project, and then locks this bootstrap path automatically.</p>
        </div>
        <Link className="button secondary" href="/console">← Back to console</Link>
      </section>
      <div className="shell setup-route-body"><BootstrapProject /></div>
    </main>
  );
}
