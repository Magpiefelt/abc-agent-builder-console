# ADR-0003: pgcrypto for at-rest secret encryption

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** ABC core engineering, GoA security advisory (informal)

## Context

ABC stores secrets on behalf of users — third-party tool credentials
(GitHub PATs, Brave search keys, custom SMTP credentials for the email
tool), and webhook signing secrets (Backlog B3). These have to be:

- **Confidential at rest.** A database backup tape, a DBA's `SELECT * FROM
  user_secrets`, or a stolen pg_dump must not leak the plaintext.
- **Recoverable in-process.** Tools that need a secret to function (e.g.
  `github_api`) must be able to fetch+decrypt at call time without a human
  in the loop.
- **Rotatable.** When `SECRETS_VAULT_KEY` is rotated, every existing row
  must re-encrypt under the new key without downtime.
- **Auditable.** Every read of a secret writes a `SECRET_ACCESSED` audit
  row tagged with the calling tool and the secret label (never the value).

We considered application-layer encryption (libsodium / `node:crypto` AES-GCM)
versus database-layer encryption (PostgreSQL's pgcrypto extension).

## Decision

Use **pgcrypto's symmetric `pgp_sym_encrypt` / `pgp_sym_decrypt`** with the
key supplied at query time via `SECRETS_VAULT_KEY`. The key is loaded once at
backend boot, never persisted to disk by ABC.

Schema:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE user_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    ...
);
```

Write:

```sql
INSERT INTO user_secrets (user_id, label, encrypted_value)
VALUES ($1, $2, pgp_sym_encrypt($3, $4));
-- $3 = plaintext, $4 = SECRETS_VAULT_KEY
```

Read:

```sql
SELECT pgp_sym_decrypt(encrypted_value, $1) AS plaintext
FROM user_secrets
WHERE user_id = $2 AND label = $3;
```

Key fingerprinting on boot (`services/secretsVault.ts:logVaultFingerprint`)
logs the SHA-256 prefix so ops can confirm which key version is loaded
without leaking it.

Rotation lives in `services/secretsVault.ts:rotateKey(oldKey, newKey)`. It
streams every row through `pgp_sym_decrypt` with the old key and re-encrypts
with the new one, in a transaction.

## Consequences

**Positive.**

- Encryption happens inside the database engine — no plaintext traverses
  application memory longer than the single query-result lifetime.
- Replication and backup tapes are encrypted-at-rest by default; the
  attacker also needs `SECRETS_VAULT_KEY` to make use of the bytes.
- Auditability: a SQL-level `EXPLAIN` confirms the encryption call is
  always present. There's no path where someone forgets to encrypt.
- pgcrypto is bundled with PostgreSQL — no additional dependency tree.

**Negative.**

- The key has to be passed in every query. That's a string in process
  memory; a memory-dumping attacker could read it. Mitigation: process
  memory is harder to extract than a database tape, and ABC's `secretsVault`
  is the only path where the key is referenced.
- Rotation is row-by-row, so a million-row rotation takes minutes. We
  accept this — secrets are low-cardinality (tens per user).
- pgcrypto's `pgp_sym_encrypt` defaults to CAST5 cipher under the hood
  unless told otherwise; we explicitly pass `compress-algo=0, cipher-algo=aes256`
  to upgrade to AES-256.

## Alternatives considered

1. **Application-layer `node:crypto` AES-GCM.** Rejected: plaintext exists
   in Node memory longer (per-request); harder to enforce uniform use; the
   SQL becomes `INSERT ... VALUES ($1, $2, $3)` with no compiler-enforced
   reminder to encrypt.
2. **Hashicorp Vault** as a separate service. Rejected for this phase:
   adds a service to deploy + monitor; a future migration is trivial (the
   `setSecret`/`getSecret` interface in `secretsVault.ts` is the only
   abstraction that would change).
3. **Cloud KMS (AWS KMS / Google Cloud KMS / Azure Key Vault).** Rejected
   for the first phase because data residency requirements for Protected B
   complicate the KMS region pinning. Reconsider during Nexus deployment
   if a GoA-approved Canadian KMS is offered.
4. **Plaintext in `secrets` table behind RBAC.** Rejected outright — fails
   even basic SOC2 and Protected B requirements.
