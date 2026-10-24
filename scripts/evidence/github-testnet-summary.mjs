#!/usr/bin/env node
// Produce a tiny SAFE artifact; raw on-chain/API evidence is never uploaded.
// The redacted review bundle is generated only after every scenario passes.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}
async function optionalJson(folder, file) {
  try { return JSON.parse(await readFile(join(folder, file), 'utf8')); } catch { return null; }
}
export function safeReport(summary, failure, wallet, verified = false) {
  const scenarios = Array.isArray(summary?.scenarios) ? summary.scenarios :
    Array.isArray(failure?.scenarios) ? failure.scenarios.map(s => ({ name: s.name, passed: s.passed })) : [];
  const scenariosPassed = summary?.passed === true && scenarios.length === 4 && scenarios.every(s => s.passed === true);
  const passed = scenariosPassed && verified;
  return {
    schemaVersion: 'cellflow-github-testnet-summary-v1',
    status: passed ? 'PASS' : (scenariosPassed ? 'UNVERIFIED' : (summary || failure ? 'FAILED_OR_INCOMPLETE' : 'NOT_STARTED')),
    // Do not echo error stacks or HTTP responses: they may include credentials.
    reason: passed ? 'Four strict live Testnet scenarios passed and the redacted review bundle was verified' :
      (scenariosPassed ? 'Four scenarios passed, but the redacted release-pinned review bundle was NOT verified.' :
      'No complete four-scenario live PASS. Inspect the private job log and verify funding/deployed SHA/RPC availability.'),
    runId: typeof summary?.runId === 'string' ? summary.runId :
      (typeof failure?.runId === 'string' ? failure.runId : null),
    wallets: {
      // Public addresses remain visible even if the job fails before RPC / balance checks.
      A: [wallet?.addressA, process.env.CELLFLOW_TESTNET_ADDRESS_A].find(a => typeof a === 'string' && a.startsWith('ckt1')) ?? null,
      B: [wallet?.addressB, process.env.CELLFLOW_TESTNET_ADDRESS_B].find(a => typeof a === 'string' && a.startsWith('ckt1')) ?? null,
    },
    scenarios: scenarios.filter(s => typeof s.name === 'string').map(s => ({
      name: s.name.slice(0, 120), passed: s.passed === true,
    })),
    github: { runId: process.env.GITHUB_RUN_ID ?? null, sha: process.env.GITHUB_SHA ?? null },
    notice: 'A PASS requires real Testnet broadcasts and independent on-chain confirmations, not simulated tests.',
  };
}
export async function writeGithubReport(source, dest, summaryPath) {
  const [summary, failure, wallets] = await Promise.all([
    optionalJson(source, '99-summary.json'),
    optionalJson(source, '99-failure.json'),
    optionalJson(source, '03-wallets.json'),
  ]);
  const verified = await access(join(source, '.state', 'github-bundle-verified.ok')).then(() => true, () => false);
  const report = safeReport(summary, failure, wallets, verified);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'status.json'), JSON.stringify(report, null, 2) + '\n');
  const markdown = [
    '## CellFlow real CKB Testnet', '',
    `**Result:** ${report.status}`, '',
    ...(report.github.runId ? [`GitHub Actions run: ${report.github.runId}`] : []),
    ...(report.github.sha ? [`GitHub commit: ${report.github.sha}`] : []), '',
    report.reason, '',
    ...Object.entries(report.wallets).map(([label, address]) =>
      `Wallet ${label}: ${address ? `\`${address}\`` : 'not observed (configure/fund isolated signer)'}`),
    '',
    '| Real Testnet scenario | Result |', '| --- | --- |',
    ...report.scenarios.map(s => `| ${s.name.replace(/\|/g, '\\|')} | ${s.passed ? 'PASS' : 'FAIL'} |`),
    '', 'The verified, redacted chain-evidence artifact is uploaded **only** after a complete PASS.', '',
  ].join('\n');
  await writeFile(join(dest, 'status.md'), markdown);
  if (summaryPath) await writeFile(summaryPath, markdown, { flag: 'a' });
  console.log(`Testnet status: ${report.status}; public status: ${join(dest, 'status.json')}`);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeGithubReport(resolve(flag('--source', '.testnet-ci-evidence')),
    resolve(flag('--out', '.testnet-ci-report')), process.env.GITHUB_STEP_SUMMARY || null);
}
