"use client";

import { useMemo, useState } from "react";
import StatusBadge from "./StatusBadge.tsx";

const lifecycle = [
  { status: "CREATED", title: "Create durable intent", detail: "CellFlow stores the business intent before any CKB submission begins." },
  { status: "PREPARED", title: "Persist deterministic tx hash", detail: "The signed transaction identity is stored before broadcast, closing the ambiguous-submit gap." },
  { status: "SUBMISSION_UNKNOWN", title: "RPC response is lost", detail: "A timeout is recorded as uncertainty—not as failure and not as permission to blindly rebroadcast." },
  { status: "PENDING", title: "Recover by tx hash", detail: "Reconciliation finds the transaction on CKB and resumes normal lifecycle tracking." },
  { status: "COMMITTED", title: "Observe canonical commit", detail: "CellFlow records the canonical block and continues until the configured confirmation policy is satisfied." },
  { status: "CONFIRMED", title: "Verify the live Cell", detail: "Expected output fields and live-Cell state are verified before the application treats the operation as settled." },
] as const;

const curlSnippet = `# 1) Create a durable business intent\ncurl -X POST "$CELLFLOW_URL/api/v1/intents" \\\n  -H "Authorization: Bearer $CELLFLOW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "intentId": "skillpass-transfer-1042",\n    "metadata": {"useCase":"SkillPass transfer","from":"Alice","to":"Bob"},\n    "expectedCells": [{\n      "outputIndex": 0,\n      "mode": "live",\n      "lock": {"args":"0xBOB_LOCK_ARGS"}\n    }]\n  }'\n\n# 2) After signing, persist the deterministic transaction hash before broadcast\ncurl -X POST "$CELLFLOW_URL/api/v1/intents/skillpass-transfer-1042/prepare" \\\n  -H "Authorization: Bearer $CELLFLOW_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"txHash":"0xYOUR_64_HEX_TX_HASH"}'\n\n# 3) Reconcile / inspect at any time\ncurl "$CELLFLOW_URL/api/v1/intents/skillpass-transfer-1042" \\\n  -H "Authorization: Bearer $CELLFLOW_API_KEY"`;

const sdkSnippet = `const operation = await flow.prepareTransaction({\n  intentId: "skillpass-transfer-1042",\n  transaction,\n  signer,\n  expectedCells: [{\n    outputIndex: 0,\n    mode: "live",\n    lock: { args: bobLockArgs }\n  }]\n});\n\n// CellFlow already knows the deterministic tx hash here.\nawait operation.broadcast();`;

export default function ExampleUse() {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"curl" | "sdk">("curl");
  const active = lifecycle[step] ?? lifecycle[0];
  const progress = useMemo(() => ((step + 1) / lifecycle.length) * 100, [step]);

  async function copySnippet() {
    await navigator.clipboard?.writeText(tab === "curl" ? curlSnippet : sdkSnippet);
  }

  return (
    <section id="example" className="panel example-panel" aria-labelledby="example-title">
      <div className="section-heading">
        <div>
          <div className="kicker">Interactive example · local only</div>
          <h2 id="example-title">See how CellFlow protects a SkillPass transfer</h2>
          <p>This walkthrough does not submit anything to CKB. It demonstrates the recovery model using Alice → Bob service-right transfer.</p>
        </div>
        <div className="example-controls">
          <button className="secondary" type="button" onClick={() => setStep(0)}>Reset</button>
          <button type="button" onClick={() => setStep((current) => Math.min(current + 1, lifecycle.length - 1))} disabled={step === lifecycle.length - 1}>Next step</button>
        </div>
      </div>

      <div className="example-grid">
        <div className="example-flow-card">
          <div className="example-pass">
            <div>
              <span className="micro-label">Business intent</span>
              <strong>SkillPass Service Bundle</strong>
              <small>Alice → Bob · transferable entitlement</small>
            </div>
            <StatusBadge value={active.status} />
          </div>
          <div className="progress-track" aria-label={`Example progress ${step + 1} of ${lifecycle.length}`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="example-step-copy">
            <span className="step-number">0{step + 1}</span>
            <div>
              <h3>{active.title}</h3>
              <p>{active.detail}</p>
            </div>
          </div>
          <ol className="lifecycle-mini">
            {lifecycle.map((item, index) => (
              <li key={item.status} className={index < step ? "done" : index === step ? "active" : ""}>
                <button type="button" onClick={() => setStep(index)} aria-label={`Show ${item.title}`}>
                  <span>{index < step ? "✓" : index + 1}</span>
                  {item.title}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="code-card">
          <div className="code-toolbar">
            <div className="segmented" role="tablist" aria-label="Integration example">
              <button type="button" role="tab" aria-selected={tab === "curl"} className={tab === "curl" ? "active" : ""} onClick={() => setTab("curl")}>REST / cURL</button>
              <button type="button" role="tab" aria-selected={tab === "sdk"} className={tab === "sdk" ? "active" : ""} onClick={() => setTab("sdk")}>CCC helper</button>
            </div>
            <button type="button" className="link-button" onClick={copySnippet}>Copy</button>
          </div>
          <pre><code>{tab === "curl" ? curlSnippet : sdkSnippet}</code></pre>
          <div className="code-note"><strong>Key invariant:</strong> persist transaction identity before broadcast; after a timeout, reconcile by hash before deciding whether any retry is safe.</div>
        </div>
      </div>
    </section>
  );
}
