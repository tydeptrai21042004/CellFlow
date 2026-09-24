# Expected Cell assertions

V1 implementation for verifying CKB transaction outputs after confirmation. Assertions deliberately stay narrow and deterministic.

Supported predicates:

- output index;
- exact capacity hex;
- lock `codeHash`, `hashType`, `args`;
- type script `codeHash`, `hashType`, `args`, or explicit `null`;
- exact output data hex.

A failed assertion changes workflow state to `CONFLICTED` and is retained in the evidence output. More complex application-specific predicates should remain outside the V1 critical path.
