# SkillPass pilot integration

`cellflow-integration.ts` shows the intended boundary for an Alice → Bob SkillPass transfer. SkillPass still builds the capability transaction and owns all entitlement/business policy. CellFlow receives only the signed transaction identity, lifecycle metadata and optional expected output-Cell assertions.

The critical ordering is **sign → compute tx hash → persist intent/hash → broadcast**. Therefore a network timeout after node acceptance does not force SkillPass to guess whether it should resend the transaction.
