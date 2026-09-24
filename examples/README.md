# Examples

## Purpose

Examples must be runnable and minimal. They prove adoption paths and should avoid copying internal implementation. Every example needs setup, environment variables, expected output and cleanup.

## Required deliverables

- A concise public interface or responsibility statement for this folder.
- Tests or verification appropriate to its role.
- Documentation updated in the same change when behavior changes.
- No hidden dependency on local process state.
- Clear error behavior and structured logs where runtime code is involved.

## Implementation rules

1. Keep the folder's responsibility narrow; move reusable logic into the correct package.
2. Do not duplicate state-machine rules; import/use the canonical core model.
3. Validate external data before it reaches domain logic.
4. Preserve tenant/project isolation in every persistence or API path.
5. Do not add Fiber/RGB++/AI-agent functionality to solve a local problem unless the project scope is formally expanded.
6. Prefer deterministic identifiers, explicit timestamps and append-only events for operational history.
7. Any retry path must explain idempotency and terminal behavior.

## Definition of done

A change in this folder is complete only when:

- its behavior is testable;
- failures are observable;
- restart/redeploy behavior is safe where applicable;
- documentation matches the implementation;
- there is a reviewer-verifiable path or example;
- no secret/private signing material is introduced.

## Questions to answer during implementation

- What is the source of truth?
- What happens if the process dies immediately after this operation?
- What happens if the same request is executed twice?
- What happens if CKB RPC is temporarily unavailable?
- Can this behavior be proven in CI or with an evidence artifact?
- Is this functionality already better owned by CCC, Cellora, Vercel, Neon or the consuming application?
