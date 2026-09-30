alter table transaction_attempts
  add column if not exists signed_payload_hash_sha256 text null;

alter table transaction_attempts
  drop constraint if exists transaction_attempts_signed_payload_hash_sha256_check;

alter table transaction_attempts
  add constraint transaction_attempts_signed_payload_hash_sha256_check
  check (
    signed_payload_hash_sha256 is null
    or signed_payload_hash_sha256 ~ '^0x[0-9a-f]{64}$'
  );
