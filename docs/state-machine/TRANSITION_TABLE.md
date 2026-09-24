# Canonical Transition Table

Initial recommended V1 transitions:

| From | To | Trigger |
|---|---|---|
| none | CREATED | intent accepted and persisted |
| CREATED | SIGNED | signed tx attached before submit |
| CREATED | SUBMITTED | tx hash registered/tracked |
| SIGNED | SUBMITTED | broadcast attempt accepted or tx hash known |
| SUBMITTED | PENDING | RPC observes pending |
| SUBMITTED | PROPOSED | RPC observes proposed |
| SUBMITTED | COMMITTED | RPC observes committed |
| SUBMITTED | UNKNOWN | RPC cannot determine state after bounded attempt |
| PENDING | PROPOSED | RPC observes proposed |
| PENDING | COMMITTED | RPC observes committed |
| PENDING | UNKNOWN | state becomes ambiguous |
| PROPOSED | COMMITTED | RPC observes committed |
| UNKNOWN | RECONCILING | durable workflow starts recovery |
| RECONCILING | PENDING | state rediscovered |
| RECONCILING | PROPOSED | state rediscovered |
| RECONCILING | COMMITTED | state rediscovered |
| any non-terminal | REJECTED | authoritative rejection observed |
| any non-terminal | CONFLICTED | conflicting input/business invariant observed |
| any non-terminal | EXPIRED | explicit operator/project expiry policy reached |

Rules:

- Store raw observation with every chain-derived transition.
- `COMMITTED`, `REJECTED`, `CONFLICTED`, `EXPIRED` are terminal in V1.
- Recovery from a terminal state requires an operator/admin audit event and a new intent, not silent mutation.
- `UNKNOWN` is not failure.
