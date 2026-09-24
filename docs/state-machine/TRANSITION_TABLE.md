# Canonical state model

CellFlow uses three orthogonal state axes. This avoids mixing network submission, observed CKB state and orchestration behavior in one enum.

## Submission

| From | To | Meaning |
|---|---|---|
| `NOT_SUBMITTED` | `PREPARED` | signed transaction identity persisted before RPC broadcast |
| `PREPARED` | `BROADCASTING` | RPC broadcast attempt starts |
| `BROADCASTING` | `SUBMITTED` | RPC returned the expected tx hash |
| `BROADCASTING` | `SUBMISSION_UNKNOWN` | RPC/network ended ambiguously |
| `SUBMISSION_UNKNOWN` | `SUBMITTED` | reconciliation/broadcast response proves acceptance |

CellFlow does not automatically rebroadcast from `SUBMISSION_UNKNOWN`.

## Chain observation

`UNOBSERVED`, `UNKNOWN`, `PENDING`, `PROPOSED`, `COMMITTED`, `REJECTED`.

Raw RPC payload and observation timestamp are stored for chain-derived events.

## Workflow

| State | Meaning |
|---|---|
| `IDLE` | no recovery work currently required |
| `RECONCILING` | state is being rediscovered / RPC observation remains non-terminal |
| `WAITING_CONFIRMATIONS` | committed but confirmation policy is not satisfied |
| `CONFIRMED` | confirmation policy satisfied |
| `REORGED` | authoritative post-commit observation moved back to pending/proposed or committed in a different block |
| `CONFLICTED` | business/expected-Cell invariant failed |
| `EXPIRED` | operator/project expiry policy ended processing |

An `UNKNOWN` response after a prior commit is treated as uncertainty, not sufficient evidence of reorg by itself.

## Overall status projection

The API derives a developer-friendly status from the three axes:

`CREATED`, `PREPARED`, `SUBMITTING`, `SUBMITTED`, `UNKNOWN`, `PENDING`, `PROPOSED`, `COMMITTED`, `CONFIRMED`, `RECONCILING`, `REORGED`, `REJECTED`, `CONFLICTED`, `EXPIRED`.

`COMMITTED` is not permanently terminal. `CONFIRMED`, `REJECTED`, `CONFLICTED`, and `EXPIRED` stop the normal durable polling loop.
