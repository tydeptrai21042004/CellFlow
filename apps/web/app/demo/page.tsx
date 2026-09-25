import type { Metadata } from "next";
import Link from "next/link";
import ProductHeader from "../../components/ProductHeader.tsx";
import ExampleUse from "../../components/ExampleUse.tsx";

export const metadata: Metadata = {
  title: "CellFlow Demo — Transaction Recovery Walkthrough",
  description: "Local-only CellFlow lifecycle walkthrough with no API key and no chain writes.",
};

export default function DemoPage() {
  return (
    <main className="demo-page">
      <ProductHeader active="demo" />
      <section className="demo-heading shell">
        <div>
          <div className="demo-safety-badge">Local simulation · no API key · no chain writes</div>
          <h1>Transaction recovery walkthrough</h1>
          <p>Explore the lifecycle without connecting a project. This page uses local UI state only and never presents simulated activity as production data.</p>
        </div>
        <Link className="button secondary" href="/console">Go to real console →</Link>
      </section>

      <div className="shell demo-layout">
        <ExampleUse />
        <section className="demo-explainer">
          <article><span>Why this matters</span><h2>A broadcast timeout is not a failed transaction.</h2><p>Blindly retrying can duplicate business effects. CellFlow records deterministic identity first, then reconciles chain truth by hash.</p></article>
          <article><span>What the demo proves</span><h2>The state machine and operator model.</h2><p>It demonstrates CREATED → PREPARED → SUBMISSION_UNKNOWN → PENDING → COMMITTED → CONFIRMED and the expected-Cell verification boundary.</p></article>
          <article><span>What it does not prove</span><h2>No fake production claims.</h2><p>This walkthrough does not submit to CKB, generate real confirmations or create durable evidence. Use the console with a configured project for live operations.</p></article>
        </section>
      </div>

      <footer className="shell footer"><div><strong>CellFlow Demo</strong><span>Isolated educational surface.</span></div><span>Production controls live under /console.</span></footer>
    </main>
  );
}
