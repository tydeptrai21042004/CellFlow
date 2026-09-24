# Contribution Plan

## Goal

Make CellFlow easy for CKBuilders to inspect and contribute without understanding the entire codebase.

## Contribution layers

- core state machine: high review bar, deterministic tests required;
- RPC adapters: compatibility tests required;
- dashboard/UI: ordinary product contribution rules;
- examples: lowest barrier for ecosystem contributors;
- docs/evidence: contributions encouraged from pilot projects.

## Pull request requirements

Every PR should state:

- problem;
- scope;
- affected state transitions;
- migration implications;
- tests added;
- deployment impact;
- security impact.

Changes to public SDK/API schemas require a compatibility note.

## Release discipline

Use changesets or equivalent package release notes. Maintain semantic versioning. Pilot releases can use `0.x`, but breaking changes must still be documented.
