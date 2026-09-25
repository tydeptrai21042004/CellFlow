# Production UI & Stability Upgrade

This upgrade keeps CellFlow's CKB-native scope intact while making the operator experience suitable for a real hosted pilot.

## UI changes

- Compact product header and operations-focused hero.
- Database and CKB RPC health indicators.
- Project KPI cards for total, active, confirmed and attention-required intents.
- Intent search and operational status filters.
- Optional 15-second auto-refresh without persisting credentials.
- Rich intent detail drawer with the three independent status axes, confirmation progress, assertion result, metadata, expected Cells, explorer link and audit timeline.
- API-key lifecycle UI with one-time secret display and protection against revoking the key currently in use.
- Signed webhook endpoint creation and test-delivery UI.
- First-deploy bootstrap moved into a collapsible low-priority section.
- Responsive layout, reduced-motion support, explicit labels, live status announcements and dialog semantics.

## Example use in the UI

The `Example` section is explicitly labeled **local only** and never sends a transaction. It demonstrates the SkillPass Alice → Bob service-right transfer through:

1. durable intent creation;
2. deterministic transaction identity persisted before broadcast;
3. ambiguous RPC timeout (`SUBMISSION_UNKNOWN`);
4. recovery by deterministic transaction hash;
5. canonical CKB commit;
6. configured confirmation policy plus live-Cell verification.

The example includes copyable REST/cURL and CCC-helper integration snippets.

## Stability coverage

The deterministic test suite now contains **47 tests**:

- 22 core lifecycle, reorg, confirmation and validation tests;
- 11 expected-Cell/live-Cell assertion tests;
- 14 hardening, repository, UI-safety, accessibility and deployment-contract tests.

Additional checks cover malformed block heights, confirmation depth boundaries, invalid intent IDs, proposed/unknown recovery, rejected-state immutability, status precedence, missing block depth, huge confirmation distance, missing expected outputs, type/lock mismatches, case-insensitive hex values, UI credential persistence, intent-detail audit data, example isolation, integration controls and Vercel output/cron configuration.

## Deployment note

`vercel.json` intentionally does not specify `outputDirectory`. With the Vercel project Root Directory set to `apps/web`, the Next.js preset owns `.next` and avoids the incorrect `apps/web/apps/web/.next` lookup. The bundled cron schedule is once daily (`0 0 * * *`) so it is compatible with Vercel Hobby; Pro deployments can increase the repair-sweep cadence.
