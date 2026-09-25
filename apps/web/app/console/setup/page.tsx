import type { Metadata } from "next";
import Link from "next/link";
import BootstrapProject from "../../../components/BootstrapProject.tsx";
import ProductHeader from "../../../components/ProductHeader.tsx";

export const metadata: Metadata = {
  title: "CellFlow Setup — Project Bootstrap",
  description: "One-time CellFlow project provisioning surface. Disable bootstrap after initial setup.",
};

export default function SetupPage() {
  return (
    <main className="console-page setup-page">
      <ProductHeader active="console" />
      <section className="console-heading shell">
        <div>
          <div className="eyebrow">Deployment administration</div>
          <h1>Project bootstrap</h1>
          <p>Initial provisioning is intentionally separated from normal transaction operations. Complete it once, disable the bootstrap endpoint, and return to the operator console.</p>
        </div>
        <Link className="button secondary" href="/console">← Back to console</Link>
      </section>
      <div className="shell setup-route-body"><BootstrapProject /></div>
    </main>
  );
}
