# `@cellflow/webhooks`

Signed, retryable webhook delivery with SSRF controls.

Each endpoint has its own generated secret, encrypted at rest with `CELLFLOW_ENCRYPTION_KEY`. Deliveries include timestamp/event/delivery IDs and an HMAC-SHA256 signature. The sender validates DNS results, rejects private/loopback/link-local/metadata targets, connects to a validated IP while preserving TLS SNI/Host, refuses redirects, limits response size and retries with bounded backoff.

The package deliberately does not use a global signing secret, and production HTTP destinations are rejected.
