/**
 * Persist a replacement candidate *before* its first network submission.
 * Used only by the funded Testnet harness: deliberate conflicting-input
 * submission bypasses the regular non-RBF preflight on purpose.
 * The network may accept a transaction despite a lost HTTP response. All
 * outcomes leave a durably recorded exact transaction hash to reconcile.
 */
export async function submitPersistedReplacement({flow, intentId, candidate, parentAttemptId, metadata, expectedCells, submit}) {
  if (!candidate || !candidate.txHash || !candidate.signedPayloadHashSha256 || !Array.isArray(candidate.inputOutPoints)) {
    throw new TypeError('Replacement requires a fully signed, fingerprinted transaction');
  }
  if (typeof parentAttemptId !== 'string' || !parentAttemptId) {
    throw new TypeError('Replacement requires the original persisted attempt ID');
  }
  // A failure here MUST abort before broadcasting. The original attempt
  // remains tracked, and no unknown replacement can enter the mempool.
  const persisted = await flow.prepare({
    intentId,
    txHash: candidate.txHash,
    signedPayloadHashSha256: candidate.signedPayloadHashSha256,
    inputOutPoints: candidate.inputOutPoints,
    inputRefs: candidate.inputRefs,
    attemptKind: 'RBF_REPLACEMENT',
    parentAttemptId,
    metadata,
    expectedCells,
  });
  if (String(persisted?.txHash ?? '').toLowerCase() !== candidate.txHash.toLowerCase()) {
    throw new Error('Replacement was not confirmed as the active durable candidate; refusing broadcast');
  }
  await flow.markBroadcasting(intentId);
  let result;
  try {
    result = await submit(candidate.signed);
  } catch (error) {
    // A transport throw may occur after actual acceptance. Do not retry or
    // forget the candidate; require reconciliation of the persisted hash.
    await flow.markAmbiguous(intentId, {
      errorType: 'TRANSPORT_UNKNOWN', errorCode: 'RBF_TRANSPORT_UNKNOWN',
      errorMessage: 'Replacement submission had no reliable RPC outcome',
    });
    throw error;
  }
  if (result?.accepted === true) {
    if (typeof result.returnedHash !== 'string' || result.returnedHash.toLowerCase() !== candidate.txHash.toLowerCase()) {
      await flow.markAmbiguous(intentId, {
        errorType: 'HASH_MISMATCH',
        errorMessage: 'Replacement node returned a different hash; reconcile the persisted candidate',
      });
      throw new Error('Replacement transaction hash mismatch; do not broadcast again');
    }
    // Bookkeeping failure after node acceptance is not permission to rebroadcast.
    await flow.markSubmitted(intentId);
  } else if (result?.classification?.outcome === 'NODE_REJECTED') {
    await flow.markNodeRejected(intentId, result.classification.evidence);
  } else {
    await flow.markAmbiguous(intentId, result?.classification?.evidence ?? {
      errorType: 'TRANSPORT_UNKNOWN',
      errorMessage: 'Unknown replacement broadcast result; reconcile before retry',
    });
  }
  return { ...result, persistedBeforeBroadcast: true };
}
