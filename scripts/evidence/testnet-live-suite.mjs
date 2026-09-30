#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ccc } from "@ckb-ccc/core";
import {
  CellFlowClient,
  classifyBroadcastError,
  classifyInputRefs,
  extractInputOutPoints,
  prepareTrackedTransaction,
} from "@cellflow/ccc";
import { signedPayloadFingerprintSha256 } from "@cellflow/core";

const TESTNET_CHAIN = "ckb_testnet";
const DEFAULT_CELLFLOW_URL = "https://cellflow-brown.vercel.app";
const DEFAULT_PRIMARY_RPC = "https://testnet.ckbapp.dev/rpc";
const DEFAULT_FALLBACK_RPC = "https://testnet.ckb.dev/";

// Public, TESTNET-ONLY development identities. These defaults are intentionally
// limited to CKB Testnet and must never be reused on Mainnet. Override them with
// CKB_TESTNET_PRIVATE_KEY_A/B when you want isolated reviewer/faucet wallets.
const DEFAULT_TESTNET_PRIVATE_KEY_A = "21cc3b4e32a1e9afdd51f54510c816d38bb7be37d40056854a467f4d92ebd96e";
const DEFAULT_TESTNET_PRIVATE_KEY_B = "3fc54dc0e24080697472c447dc38557adb69fad0289d917fdbd4445c9653776b";

const endpoint = (process.env.CELLFLOW_URL?.trim() || DEFAULT_CELLFLOW_URL).replace(/\/$/, "");
const apiKey = resolveCellFlowApiKey();
const privateKeyA = normalizePrivateKey(process.env.CKB_TESTNET_PRIVATE_KEY_A?.trim() || DEFAULT_TESTNET_PRIVATE_KEY_A);
const privateKeyB = normalizePrivateKey(process.env.CKB_TESTNET_PRIVATE_KEY_B?.trim() || DEFAULT_TESTNET_PRIVATE_KEY_B);
const rpcUrls = unique([
  process.env.CKB_RPC_URL?.trim() || DEFAULT_PRIMARY_RPC,
  ...(process.env.CKB_RPC_FALLBACK_URLS || DEFAULT_FALLBACK_RPC).split(/[\s,]+/).map((v) => v.trim()).filter(Boolean),
]);
const timeoutMs = numberEnv("CELLFLOW_TESTNET_TIMEOUT_MS", 900_000);
const pollMs = numberEnv("CELLFLOW_TESTNET_POLL_MS", 5_000);
const propagationDelayMs = numberEnv("CELLFLOW_TESTNET_PROPAGATION_DELAY_MS", 1_500);
const contentionGraceMs = numberEnv("CELLFLOW_CONTENTION_GRACE_MS", 30_000);
const sameFeeRate = BigInt(numberEnv("CELLFLOW_TESTNET_SAME_FEE_RATE", 1_000));
const lowFeeRate = BigInt(numberEnv("CELLFLOW_TESTNET_LOW_FEE_RATE", 1_000));
const highFeeRate = BigInt(numberEnv("CELLFLOW_TESTNET_HIGH_FEE_RATE", 20_000));
const stateCapacityCkb = process.env.CELLFLOW_TESTNET_STATE_CKB?.trim() || "100";
const walletSeedCapacityCkb = process.env.CELLFLOW_TESTNET_WALLET_SEED_CKB?.trim() || "100";
const ambiguousCapacityCkb = process.env.CELLFLOW_TESTNET_AMBIGUOUS_CKB?.trim() || "100";
const minBalanceCkb = process.env.CELLFLOW_TESTNET_MIN_BALANCE_CKB?.trim() || "250";
const strictRbf = (process.env.CELLFLOW_TESTNET_REQUIRE_RBF ?? "true").toLowerCase() !== "false";
const runId = `cellflow-live-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const outDir = resolve(process.env.CELLFLOW_EVIDENCE_DIR || `evidence/testnet/live/${runId}`);

const flow = new CellFlowClient({ endpoint, apiKey });
const primaryOwner = ccc.ClientPublicTestnet.open({ urls: rpcUrls });
const primaryClient = primaryOwner.value;
const signerA = new ccc.SignerCkbPrivateKey(primaryClient, privateKeyA);
const signerB = new ccc.SignerCkbPrivateKey(primaryClient, privateKeyB);
const scenarioResults = [];
const artifactFiles = [];
const startedAt = new Date().toISOString();

await mkdir(outDir, { recursive: true });

try {
  await signerA.connect();
  await signerB.connect();

  const addressA = await signerA.getRecommendedAddress();
  const addressB = await signerB.getRecommendedAddress();
  if (!addressA.startsWith("ckt") || !addressB.startsWith("ckt")) {
    throw new Error("Refusing to run: both signer addresses must be CKB Testnet addresses (ckt1...)");
  }

  const network = await verifyRpcIdentities(rpcUrls);
  await saveJson("01-network.json", network);
  if (!network.every((entry) => entry.ok)) throw new Error("At least one configured RPC endpoint is not verified as CKB Testnet");
  if (network.length < 2) throw new Error("At least two independent RPC endpoints are required for strict Testnet evidence");

  const readiness = await fetchJson(`${endpoint}/api/ready`, { headers: authHeaders() }, true);
  await saveJson("02-cellflow-readiness.json", readiness);
  if (!readiness.responseOk) throw new Error(`CellFlow readiness failed: HTTP ${readiness.status}`);

  const [balanceA, balanceB] = await Promise.all([signerA.getBalance(), signerB.getBalance()]);
  const wallets = {
    addressA,
    addressB,
    balanceA: ccc.fixedPointToString(balanceA),
    balanceB: ccc.fixedPointToString(balanceB),
    requiredMinimumEachCkb: minBalanceCkb,
  };
  await saveJson("03-wallets.json", wallets);
  const minimum = ccc.fixedPointFrom(minBalanceCkb);
  if (balanceA < minimum || balanceB < minimum) {
    throw new Error(
      `Both Testnet wallets need at least ${minBalanceCkb} CKB. Fund ${addressA} and ${addressB} with Testnet CKB and rerun.`,
    );
  }

  const alwaysSuccessLock = await ccc.Script.fromKnownScript(primaryClient, ccc.KnownScript.AlwaysSuccess, "0x");
  const knownAlwaysSuccess = await primaryClient.getKnownScript(ccc.KnownScript.AlwaysSuccess);

  scenarioResults.push(await runSameFeeApplicationRace({
    signerA, signerB, addressA, addressB, alwaysSuccessLock, knownAlwaysSuccess,
  }));
  scenarioResults.push(await runHigherFeeRbf({
    signerA, signerB, addressA, addressB, alwaysSuccessLock, knownAlwaysSuccess,
  }));
  scenarioResults.push(await runWalletInputRace({ signer: signerA, address: addressA }));
  scenarioResults.push(await runAmbiguousRecovery({ signer: signerA, address: addressA }));

  const projectEvidence = await fetchJson(`${endpoint}/api/v1/project-evidence`, {
    method: "POST",
    headers: authHeaders(),
    body: "{}",
  });
  await saveJson("90-project-evidence.json", projectEvidence);

  const summary = buildSummary({
    startedAt,
    finishedAt: new Date().toISOString(),
    runId,
    endpoint,
    rpcUrls,
    addressA,
    addressB,
    scenarios: scenarioResults,
    strictRbf,
  });
  await saveJson("99-summary.json", summary);
  await writeChecksums();
  await writeReadme(summary);

  console.log(JSON.stringify({ outDir, ...summary }, null, 2));
  if (!summary.passed) process.exitCode = 2;
} catch (error) {
  const failure = {
    schemaVersion: "cellflow-testnet-live-suite-failure-v1",
    runId,
    startedAt,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack || error.message : String(error),
    scenarios: scenarioResults,
  };
  await saveJson("99-failure.json", failure).catch(() => undefined);
  await writeChecksums().catch(() => undefined);
  console.error(failure.error);
  process.exitCode = 2;
} finally {
  await primaryOwner.dispose().catch(() => undefined);
}

async function runSameFeeApplicationRace(ctx) {
  const name = "two-wallet-same-fee-application-contention";
  const started = new Date().toISOString();
  const state = await createSharedStateCell(ctx.signerA, ctx.alwaysSuccessLock, `0x${Buffer.from("same-fee").toString("hex")}`);
  const stateOutPoint = { txHash: state.txHash, index: 0 };
  const expectedCells = [expectedLiveCell(0, ctx.alwaysSuccessLock)];
  const common = { runId, scenario: name, stateOutPoint };

  const txA = await buildStateTransition(ctx.signerA, ctx.alwaysSuccessLock, ctx.knownAlwaysSuccess, stateOutPoint, sameFeeRate, "0xa1");
  const txB = await buildStateTransition(ctx.signerB, ctx.alwaysSuccessLock, ctx.knownAlwaysSuccess, stateOutPoint, sameFeeRate, "0xb1");

  const intentA = `${runId}:app-race:a`;
  const intentB = `${runId}:app-race:b`;
  const trackedA = await prepareTrackedTransaction({
    signer: ctx.signerA,
    transaction: txA,
    flow,
    intentId: intentA,
    metadata: { ...common, wallet: "A", feeRate: sameFeeRate.toString() },
    expectedCells,
    applicationInputs: [stateOutPoint],
  });
  const preparedB = await prepareManual(ctx.signerB, txB, intentB, {
    metadata: { ...common, wallet: "B", feeRate: sameFeeRate.toString() },
    expectedCells: [],
    applicationInputs: [stateOutPoint],
  });

  const hashA = await trackedA.broadcast();
  await sleep(propagationDelayMs);
  const submitB = await submitPreparedManually(preparedB);

  const aFinal = await reconcileUntil(intentA, (v) => v.status === "CONFIRMED" && v.assertionStatus === "VERIFIED");
  const bBeforeGrace = await reconcileUntil(intentB, (v) =>
    v.submissionStatus === "NODE_REJECTED" || v.conflictType === "INPUT_CONFLICT_SUSPECTED" || v.status === "CONFLICTED",
    Math.min(timeoutMs, 120_000),
  );
  await sleep(contentionGraceMs);
  const bAfterGrace = await reconcileUntil(intentB, (v) =>
    v.conflictType === "INPUT_SPENT" || v.status === "CONFLICTED" || v.recommendedAction === "REBUILD_FROM_LIVE_STATE",
  );

  const [evidenceA, evidenceB, rpcA, rpcB] = await Promise.all([
    persistIntentEvidence(intentA),
    persistIntentEvidence(intentB),
    observeAcrossRpcs(hashA),
    observeAcrossRpcs(preparedB.txHash),
  ]);

  const result = {
    name,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    stateTxHash: state.txHash,
    stateOutPoint,
    txA: hashA,
    txB: preparedB.txHash,
    submitB,
    beforeGrace: compactView(bBeforeGrace),
    afterGrace: compactView(bAfterGrace),
    winner: compactView(aFinal),
    passed: submitB.accepted === false &&
      bAfterGrace?.conflictType === "INPUT_SPENT" &&
      bAfterGrace?.recommendedAction === "REBUILD_FROM_LIVE_STATE" &&
      aFinal?.status === "CONFIRMED" && aFinal?.assertionStatus === "VERIFIED",
  };
  await saveJson("10-two-wallet-same-fee-race.json", { result, evidenceA, evidenceB, rpcA, rpcB });
  return result;
}

async function runHigherFeeRbf(ctx) {
  const name = "two-wallet-higher-fee-rbf";
  const started = new Date().toISOString();
  const state = await createSharedStateCell(ctx.signerA, ctx.alwaysSuccessLock, `0x${Buffer.from("rbf").toString("hex")}`);
  const stateOutPoint = { txHash: state.txHash, index: 0 };
  const expectedCells = [expectedLiveCell(0, ctx.alwaysSuccessLock)];
  const metadata = { runId, scenario: name, stateOutPoint };
  const intentId = `${runId}:rbf`;

  const lowTx = await buildStateTransition(ctx.signerA, ctx.alwaysSuccessLock, ctx.knownAlwaysSuccess, stateOutPoint, lowFeeRate, "0xa2");
  const highTx = await buildStateTransition(ctx.signerB, ctx.alwaysSuccessLock, ctx.knownAlwaysSuccess, stateOutPoint, highFeeRate, "0xb2");

  const trackedLow = await prepareTrackedTransaction({
    signer: ctx.signerA,
    transaction: lowTx,
    flow,
    intentId,
    metadata: { ...metadata, lowFeeRate: lowFeeRate.toString(), highFeeRate: highFeeRate.toString() },
    expectedCells,
    applicationInputs: [stateOutPoint],
  });
  const lowPreparedView = await flow.get(intentId);
  const parentAttemptId = lowPreparedView?.activeAttemptId;
  if (typeof parentAttemptId !== "string") throw new Error("CellFlow did not expose the initial attempt id for RBF evidence");

  const preparedHigh = await signAndDescribe(ctx.signerB, highTx, [stateOutPoint]);
  const lowHash = await trackedLow.broadcast();
  await sleep(propagationDelayMs);
  const highSubmit = await rawSubmit(ctx.signerB, preparedHigh.signed);

  let highCommitted = null;
  let lowTerminal = null;
  let replacementView = null;
  if (highSubmit.accepted) {
    highCommitted = await waitForCommitted(preparedHigh.txHash);
    lowTerminal = await reconcileUntil(intentId, (v) =>
      v.conflictType === "INPUT_SPENT" || v.status === "CONFLICTED" || v.status === "REJECTED",
    );
    replacementView = await flow.prepare({
      intentId,
      txHash: preparedHigh.txHash,
      signedPayloadHashSha256: preparedHigh.signedPayloadHashSha256,
      inputOutPoints: preparedHigh.inputOutPoints,
      inputRefs: preparedHigh.inputRefs,
      attemptKind: "RBF_REPLACEMENT",
      parentAttemptId,
      metadata: { ...metadata, lowFeeRate: lowFeeRate.toString(), highFeeRate: highFeeRate.toString() },
      expectedCells,
    });
    await flow.markSubmitted(intentId);
    replacementView = await reconcileUntil(intentId, (v) => v.status === "CONFIRMED" && v.assertionStatus === "VERIFIED");
  } else {
    lowTerminal = await reconcileUntil(intentId, (v) => v.status === "CONFIRMED" || v.status === "CONFLICTED");
  }

  const evidence = await persistIntentEvidence(intentId);
  const [rpcLow, rpcHigh] = await Promise.all([observeAcrossRpcs(lowHash), observeAcrossRpcs(preparedHigh.txHash)]);
  const linkedReplacement = Array.isArray(evidence?.body?.evidence?.attempts) && evidence.body.evidence.attempts.some((attempt) =>
    attempt?.attemptKind === "RBF_REPLACEMENT" && attempt?.parentAttemptId === parentAttemptId,
  );

  const demonstratedRbf = highSubmit.accepted === true && highCommitted?.status === "committed" && linkedReplacement === true && replacementView?.status === "CONFIRMED";
  const result = {
    name,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    stateTxHash: state.txHash,
    stateOutPoint,
    lowTxHash: lowHash,
    highTxHash: preparedHigh.txHash,
    lowFeeRate: lowFeeRate.toString(),
    highFeeRate: highFeeRate.toString(),
    highSubmit,
    lowTerminal: compactView(lowTerminal),
    replacement: compactView(replacementView),
    linkedReplacement,
    rbfDemonstrated: demonstratedRbf,
    passed: strictRbf ? demonstratedRbf : (demonstratedRbf || highSubmit.accepted === false),
  };
  await saveJson("20-two-wallet-higher-fee-rbf.json", { result, evidence, rpcLow, rpcHigh });
  return result;
}

async function runWalletInputRace({ signer, address }) {
  const name = "wallet-funding-input-conflict";
  const started = new Date().toISOString();
  const self = await addressLock(address);
  const seedTx = ccc.Transaction.from({ outputs: [{ lock: self, capacity: ccc.fixedPointFrom(walletSeedCapacityCkb) }] });
  await seedTx.completeInputsByCapacity(signer);
  await seedTx.completeFeeBy(signer, sameFeeRate);
  const seedHash = await signer.sendTransaction(seedTx);
  await waitForCommitted(seedHash);
  const walletOutPoint = { txHash: String(seedHash).toLowerCase(), index: 0 };

  const txA = await buildWalletOnlySpend(signer, self, walletOutPoint, sameFeeRate, "0xc1");
  const txB = await buildWalletOnlySpend(signer, self, walletOutPoint, sameFeeRate, "0xc2");
  const intentA = `${runId}:wallet-race:a`;
  const intentB = `${runId}:wallet-race:b`;
  const metadata = { runId, scenario: name, walletOutPoint };

  const trackedA = await prepareTrackedTransaction({ signer, transaction: txA, flow, intentId: intentA, metadata, expectedCells: [] });
  const preparedB = await prepareManual(signer, txB, intentB, { metadata, expectedCells: [] });
  const hashA = await trackedA.broadcast();
  await sleep(propagationDelayMs);
  const submitB = await submitPreparedManually(preparedB);
  await waitForCommitted(hashA);
  await sleep(contentionGraceMs);
  const bFinal = await reconcileUntil(intentB, (v) =>
    v.conflictType === "INPUT_SPENT" || v.recommendedAction === "RECOLLECT_WALLET_INPUTS",
  );
  const evidence = await persistIntentEvidence(intentB);
  const result = {
    name,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    seedTxHash: seedHash,
    walletOutPoint,
    txA: hashA,
    txB: preparedB.txHash,
    submitB,
    final: compactView(bFinal),
    passed: submitB.accepted === false && bFinal?.conflictType === "INPUT_SPENT" && bFinal?.recommendedAction === "RECOLLECT_WALLET_INPUTS",
  };
  await saveJson("30-wallet-input-race.json", { result, evidence });
  return result;
}

async function runAmbiguousRecovery({ signer, address }) {
  const name = "real-broadcast-injected-lost-response-recovery";
  const started = new Date().toISOString();
  const self = await addressLock(address);
  const transaction = ccc.Transaction.from({ outputs: [{ lock: self, capacity: ccc.fixedPointFrom(ambiguousCapacityCkb) }] });
  await transaction.completeInputsByCapacity(signer);
  await transaction.completeFeeBy(signer, sameFeeRate);
  const intentId = `${runId}:ambiguous`;
  const metadata = { runId, scenario: name, faultInjection: "discard-success-after-real-send_transaction" };
  const expectedCells = [expectedLiveCell(0, self)];
  const prepared = await prepareManual(signer, transaction, intentId, { metadata, expectedCells });
  await flow.preflight(intentId);
  await flow.markBroadcasting(intentId);

  const submitted = await rawSubmit(signer, prepared.signed);
  if (!submitted.accepted) throw new Error(`Ambiguous-recovery setup transaction was rejected: ${submitted.errorMessage || "unknown"}`);

  // Fault injection is deliberate and explicit: the CKB node accepted the real
  // transaction, but the harness discards that success and persists the exact
  // state an application would have after losing the RPC response.
  await flow.markAmbiguous(intentId, {
    errorType: "TRANSPORT_UNKNOWN",
    errorCode: "INJECTED_LOST_RESPONSE",
    errorMessage: "Testnet harness intentionally discarded a successful send_transaction response",
    details: { runId, actualAcceptedTxHash: prepared.txHash },
  });

  const before = await flow.get(intentId);
  const workerOutput = resolve(outDir, "40-new-process-recovery-worker.json");
  const worker = await runRecoveryWorker(intentId, workerOutput);
  const workerDoc = JSON.parse(await readFile(workerOutput, "utf8"));
  artifactFiles.push(workerOutput);
  const evidence = await persistIntentEvidence(intentId);
  const rpc = await observeAcrossRpcs(prepared.txHash);
  const after = await flow.get(intentId);
  const fingerprintPersisted = Array.isArray(evidence?.body?.evidence?.attempts) && evidence.body.evidence.attempts.some((a) =>
    typeof a?.signedPayloadHashSha256 === "string" && a.signedPayloadHashSha256 === prepared.signedPayloadHashSha256,
  );
  const result = {
    name,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    txHash: prepared.txHash,
    signedPayloadHashSha256: prepared.signedPayloadHashSha256,
    ckbFullHash: typeof prepared.signed.hashFull === "function" ? String(prepared.signed.hashFull()) : null,
    injectedFailure: "INJECTED_LOST_RESPONSE",
    before: compactView(before),
    workerExitCode: worker.code,
    workerPassed: workerDoc.passed === true,
    after: compactView(after),
    fingerprintPersisted,
    passed: before?.submissionStatus === "SUBMISSION_UNKNOWN" && workerDoc.passed === true && after?.status === "CONFIRMED" && after?.assertionStatus === "VERIFIED" && fingerprintPersisted,
  };
  await saveJson("40-ambiguous-recovery.json", { result, evidence, rpc, worker: workerDoc });
  return result;
}

async function createSharedStateCell(signer, lock, data) {
  const tx = ccc.Transaction.from({
    outputs: [{ lock, capacity: ccc.fixedPointFrom(stateCapacityCkb) }],
    outputsData: [data],
  });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, sameFeeRate);
  const txHash = await signer.sendTransaction(tx);
  const committed = await waitForCommitted(txHash);
  return { txHash: String(txHash).toLowerCase(), committed };
}

async function buildStateTransition(signer, lock, knownAlwaysSuccess, stateOutPoint, feeRate, marker) {
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: stateOutPoint, since: 0 }],
    outputs: [{ lock, capacity: ccc.fixedPointFrom(stateCapacityCkb) }],
    outputsData: [marker],
  });
  if (knownAlwaysSuccess?.cellDeps) await tx.addCellDepInfos(signer.client, knownAlwaysSuccess.cellDeps);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, feeRate);
  return tx;
}

async function buildWalletOnlySpend(signer, lock, walletOutPoint, feeRate, marker) {
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: walletOutPoint, since: 0 }],
    outputs: [{ lock, capacity: ccc.fixedPointFrom(walletSeedCapacityCkb) }],
    outputsData: [marker],
  });
  await tx.completeFeeChangeToOutput(signer, 0, feeRate);
  return tx;
}

async function prepareManual(signer, transaction, intentId, { metadata, expectedCells, applicationInputs = [] }) {
  const described = await signAndDescribe(signer, transaction, applicationInputs);
  await flow.prepare({
    intentId,
    txHash: described.txHash,
    signedPayloadHashSha256: described.signedPayloadHashSha256,
    inputOutPoints: described.inputOutPoints,
    inputRefs: described.inputRefs,
    metadata,
    expectedCells,
  });
  const prepared = { ...described, intentId };
  Object.defineProperty(prepared, "__signer", { value: signer, enumerable: false });
  return prepared;
}

async function signAndDescribe(signer, transaction, applicationInputs = []) {
  const originalInputs = extractInputOutPoints(transaction);
  const signed = await signer.signTransaction(transaction);
  const txHash = String(signed.hash()).toLowerCase();
  const signedPayloadHashSha256 = await signedPayloadFingerprintSha256(signed);
  if (!signedPayloadHashSha256) throw new Error("Unable to compute signed-payload fingerprint");
  const inputOutPoints = extractInputOutPoints(signed);
  const inputRefs = classifyInputRefs(inputOutPoints, [], applicationInputs, originalInputs);
  return { signed, txHash, signedPayloadHashSha256, inputOutPoints, inputRefs };
}

async function submitPreparedManually(prepared) {
  // Deliberately bypass CellFlow's fail-closed preflight in this evidence-only
  // path so the CKB node itself can produce real submit-time conflict evidence.
  // Normal application code must use prepareTrackedTransaction().broadcast().
  await flow.markBroadcasting(prepared.intentId);
  const result = await rawSubmit(signerForSigned(prepared), prepared.signed);
  if (result.accepted) {
    await flow.markSubmitted(prepared.intentId);
  } else if (result.classification?.outcome === "NODE_REJECTED") {
    await flow.markNodeRejected(prepared.intentId, result.classification.evidence);
  } else {
    await flow.markAmbiguous(prepared.intentId, result.classification?.evidence ?? {
      errorType: "TRANSPORT_UNKNOWN",
      errorMessage: result.errorMessage || "Unknown submission failure",
    });
  }
  return result;
}

function signerForSigned(prepared) {
  // prepareManual retains no signer to keep evidence serialization secret-free.
  // Determine it by the wallet funding inputs: caller attaches a non-enumerable
  // signer before submission.
  if (!prepared.__signer) throw new Error("Internal harness error: prepared signer missing");
  return prepared.__signer;
}

async function rawSubmit(signer, signed) {
  try {
    const returned = await signer.client.sendTransaction(signed);
    return { accepted: true, returnedHash: String(returned).toLowerCase() };
  } catch (error) {
    const classification = classifyBroadcastError(error);
    return {
      accepted: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      classification,
    };
  }
}

async function waitForCommitted(txHash, limitMs = timeoutMs) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const observation = await rpc(rpcUrls[0], "get_transaction", [txHash]);
    const status = observation?.tx_status?.status ?? observation?.txStatus?.status ?? "unknown";
    if (status === "committed") {
      return {
        status,
        blockHash: observation?.tx_status?.block_hash ?? observation?.txStatus?.blockHash ?? null,
        observation,
      };
    }
    if (status === "rejected") throw new Error(`Transaction ${txHash} was rejected while waiting for commit`);
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for transaction ${txHash} to commit`);
}

async function reconcileUntil(intentId, predicate, limitMs = timeoutMs) {
  const deadline = Date.now() + limitMs;
  let current = null;
  while (Date.now() < deadline) {
    await flow.reconcile(intentId).catch(() => undefined);
    current = await flow.get(intentId);
    if (current && predicate(current)) return current;
    await sleep(pollMs);
  }
  return current;
}

async function persistIntentEvidence(intentId) {
  return fetchJson(`${endpoint}/api/v1/intents/${encodeURIComponent(intentId)}/evidence`, {
    method: "POST",
    headers: authHeaders(),
    body: "{}",
  });
}

async function observeAcrossRpcs(txHash) {
  const observations = [];
  for (const url of rpcUrls) {
    try {
      const [tx, tip] = await Promise.all([rpc(url, "get_transaction", [txHash]), rpc(url, "get_tip_header", [])]);
      observations.push({ url, ok: true, observedAt: new Date().toISOString(), tipNumber: tip?.number ?? null, transaction: tx });
    } catch (error) {
      observations.push({ url, ok: false, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return observations;
}

async function verifyRpcIdentities(urls) {
  const results = [];
  let genesis = null;
  for (const url of urls) {
    try {
      const [info, hash, tip] = await Promise.all([
        rpc(url, "get_blockchain_info", []),
        rpc(url, "get_block_hash", ["0x0"]),
        rpc(url, "get_tip_header", []),
      ]);
      if (!genesis) genesis = String(hash).toLowerCase();
      results.push({
        url,
        chain: info?.chain ?? null,
        genesisHash: typeof hash === "string" ? hash.toLowerCase() : null,
        tipNumber: tip?.number ?? null,
        initialBlockDownload: info?.is_initial_block_download ?? null,
        ok: info?.chain === TESTNET_CHAIN && typeof hash === "string" && hash.toLowerCase() === genesis,
      });
    } catch (error) {
      results.push({ url, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), numberEnv("CKB_RPC_TIMEOUT_MS", 15_000));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "CellFlow-Testnet-Evidence/0.3" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

async function addressLock(address) {
  return (await ccc.Address.fromString(address, primaryClient)).script;
}

function expectedLiveCell(outputIndex, lock) {
  return {
    outputIndex,
    mode: "live",
    lock: {
      codeHash: String(lock.codeHash),
      hashType: String(lock.hashType),
      args: String(lock.args),
    },
  };
}

function compactView(view) {
  if (!view) return null;
  return {
    intentId: view.intentId,
    txHash: view.txHash,
    status: view.status,
    submissionStatus: view.submissionStatus,
    chainStatus: view.chainStatus,
    workflowStatus: view.workflowStatus,
    confirmationCount: view.confirmationCount,
    assertionStatus: view.assertionStatus,
    conflictType: view.conflictType,
    conflictDetails: view.conflictDetails,
    recommendedAction: view.recommendedAction,
    activeAttemptId: view.activeAttemptId,
    winningAttemptId: view.winningAttemptId,
  };
}

async function runRecoveryWorker(intentId, output) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--experimental-transform-types", "scripts/evidence/testnet-live-reconcile-worker.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CELLFLOW_RECOVERY_INTENT_ID: intentId,
        CELLFLOW_RECOVERY_OUTPUT: output,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function buildSummary({ startedAt: start, finishedAt, runId: id, endpoint: flowEndpoint, rpcUrls: urls, addressA, addressB, scenarios, strictRbf: requireRbf }) {
  const required = scenarios.map((scenario) => ({ name: scenario.name, passed: scenario.passed }));
  return {
    schemaVersion: "cellflow-testnet-live-summary-v1",
    runId: id,
    startedAt: start,
    finishedAt,
    cellFlowEndpoint: flowEndpoint,
    rpcEndpoints: urls,
    wallets: { A: addressA, B: addressB },
    strictRbfRequired: requireRbf,
    scenarios: required,
    passed: required.every((scenario) => scenario.passed),
    limitations: [
      "The ambiguous-submit case uses explicit client-side fault injection after a real Testnet send_transaction acceptance; it does not claim a naturally occurring TCP failure.",
      "A public Testnet reorganization is observed if it happens but is not intentionally induced by this harness.",
      "RBF behavior depends on the transaction-pool policy of the Testnet RPC/node used; strict mode fails if higher-fee replacement is not actually demonstrated.",
    ],
  };
}

async function saveJson(name, value) {
  const path = resolve(outDir, name);
  await writeFile(path, JSON.stringify(value, jsonReplacer, 2) + "\n", { mode: 0o600 });
  artifactFiles.push(path);
  return path;
}

async function writeChecksums() {
  const entries = [];
  for (const path of unique(artifactFiles)) {
    try {
      const bytes = await readFile(path);
      entries.push(`${createHash("sha256").update(bytes).digest("hex")}  ${path.slice(outDir.length + 1)}`);
    } catch {}
  }
  const path = resolve(outDir, "SHA256SUMS");
  await writeFile(path, entries.sort().join("\n") + "\n", { mode: 0o600 });
}

async function writeReadme(summary) {
  const lines = [
    "# CellFlow real CKB Testnet evidence bundle",
    "",
    `Run ID: ${summary.runId}`,
    `Generated: ${summary.finishedAt}`,
    `Overall: ${summary.passed ? "PASS" : "FAIL"}`,
    "",
    "## Live scenarios",
    "",
    ...summary.scenarios.map((scenario) => `- ${scenario.passed ? "PASS" : "FAIL"}: ${scenario.name}`),
    "",
    "## Integrity",
    "",
    "Verify every generated artifact with `sha256sum -c SHA256SUMS`.",
    "",
    "The bundle intentionally contains no private keys or CellFlow API key.",
    "",
    "## Limitations",
    "",
    ...summary.limitations.map((item) => `- ${item}`),
    "",
  ];
  const path = resolve(outDir, "README.md");
  await writeFile(path, lines.join("\n"), { mode: 0o600 });
  artifactFiles.push(path);
}

async function fetchJson(url, init = {}, allowNonJson = false) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {
    if (!allowNonJson) throw new Error(`Expected JSON from ${url}, got HTTP ${response.status}: ${text.slice(0, 300)}`);
    body = { raw: text };
  }
  return { responseOk: response.ok, status: response.status, body };
}

function authHeaders() {
  return { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
}

function normalizePrivateKey(value) {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error("Testnet private keys must be exactly 32 bytes (64 hex chars)");
  return normalized;
}

function resolveCellFlowApiKey() {
  const direct = process.env.CELLFLOW_API_KEY?.trim();
  if (direct) return validateCellFlowApiKey(direct, "CELLFLOW_API_KEY");

  const bootstrapAdmin = process.env.CELLFLOW_INITIAL_ADMIN_API_KEY?.trim();
  if (bootstrapAdmin) return validateCellFlowApiKey(bootstrapAdmin, "CELLFLOW_INITIAL_ADMIN_API_KEY");

  const bootstrapToken = process.env.CELLFLOW_BOOTSTRAP_TOKEN?.trim();
  if (bootstrapToken && bootstrapToken.length >= 24) {
    return deriveBootstrapAdminApiKey(bootstrapToken);
  }

  throw new Error(
    "No CellFlow credential is available. Set CELLFLOW_API_KEY, reuse CELLFLOW_INITIAL_ADMIN_API_KEY, " +
    "or provide CELLFLOW_BOOTSTRAP_TOKEN so the harness can derive the same automatic-bootstrap admin key.",
  );
}

function deriveBootstrapAdminApiKey(bootstrapToken) {
  const suffix = createHmac("sha256", bootstrapToken)
    .update("cellflow:auto-bootstrap:initial-admin:v1", "utf8")
    .digest("base64url");
  return `cf_live_${suffix}`;
}

function validateCellFlowApiKey(value, source) {
  if (!value.startsWith("cf_live_") || value.length < 32) {
    throw new Error(`${source} must be a valid cf_live_ API key`);
  }
  return value;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
