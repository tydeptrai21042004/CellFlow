# SkillPass Integration Checklist

Choose one lifecycle only, preferably ownership transfer.

1. Identify current transaction construction/signing code.
2. Keep CCC transaction construction unchanged.
3. Define stable intent key, e.g. `skillpass-transfer:<pass-id>:<nonce-or-business-id>`.
4. Register/track transaction in CellFlow.
5. Replace bespoke status polling with CellFlow status.
6. Add webhook or server-side callback for committed/rejected state.
7. Preserve live Cell ownership verification in SkillPass; CellFlow does not replace authorization logic.
8. Run normal and failure scenarios.
9. Capture before/after code complexity and operational behavior.
10. Publish evidence JSON and demo steps.
