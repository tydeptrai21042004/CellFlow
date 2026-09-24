# Security Model

## Trust boundary

CellFlow is non-custodial. It may accept a signed transaction or transaction hash but never a private key.

## Threats addressed in V1

- leaked project API keys;
- forged webhook requests;
- replayed API requests;
- duplicate intent creation;
- malformed transaction hashes/payloads;
- SQL injection;
- SSRF through configurable callback URLs;
- excessive RPC response size;
- unbounded retry loops;
- accidental secret logging;
- cross-tenant data access;
- stale/incorrect internal state after restart.

## Required controls

- hashed API keys at rest;
- constant-time key comparison where practical;
- HMAC webhook signatures with timestamp and replay window;
- tenant ID included in every database access path;
- strict URL validation for callbacks;
- block private/loopback metadata addresses for webhooks unless explicit local development mode;
- schema validation for all public request bodies;
- rate limits per project;
- structured redaction for secrets;
- append-only state-event audit history;
- no trust in client-provided current status;
- server computes normalized state from RPC observations.

## Webhook signature format

Suggested canonical message:

```text
v1.<unix_timestamp>.<raw_body>
```

Header example:

```text
X-CellFlow-Signature: v1=<hex-hmac>
X-CellFlow-Timestamp: <unix_timestamp>
```

Publish verifier snippets in TypeScript.

## Data minimization

Store only application metadata needed for operations. Metadata should have documented size limits. Do not encourage user PII in free-form metadata.

## Security review gate

Before independent pilot:

- run dependency audit;
- verify webhook SSRF protection;
- run cross-tenant authorization tests;
- document data retention;
- document incident/revocation steps;
- confirm no signing secrets appear in logs or DB.
