# Key Rotation Runbook

This procedure rotates the symmetric `SECRETS_VAULT_KEY` used to encrypt rows in `cohen_mcleod.user_secrets`.

## Why rotate

- **Scheduled rotation:** annually, on the anniversary of initial deployment.
- **Triggered rotation:** on suspected compromise, staff offboarding with key access, or following the incident-response runbook.

## Prerequisites

- Admin access to the Render / Nexus secret panel.
- Database access (psql or admin SQL tool) to verify post-rotation row counts.
- A maintenance window of approximately 5 minutes (re-encrypt is fast even for thousands of rows; the cost is the cold restart).

> **Current limitation:** the application reads a single `SECRETS_VAULT_KEY` at boot. A dual-key window (accept old, write new) is **future work** and tracked as an operational backlog item. Until then, rotation is a maintenance-window operation.

## Procedure

### 1. Generate a new key

On a secure workstation:

```bash
openssl rand -hex 32
# Example output (do NOT use this value):
# 3a8f...7c2e
```

The output is 64 hex characters = 32 bytes. The vault rejects keys shorter than 32 bytes at boot.

### 2. Inspect the current fingerprint

Hit `GET /api/health/detailed` (admin) or check the backend logs at startup. The line looks like:

```
Secrets vault configured { "keyFingerprint": "ab12cd34", "keyLengthBytes": 64 }
```

Record this fingerprint (it is the first 8 hex chars of SHA-256(currentKey)). It is **safe to write down or log** — the fingerprint is not the key.

### 3. Schedule the maintenance window

Tell users: "Tool credentials may be briefly unavailable during a scheduled maintenance window on YYYY-MM-DD HH:MM (15 minutes)."

### 4. Run the rotation

The rotation re-encrypts every row in `user_secrets` in a single transaction. Run it through a one-shot Node script that loads both keys:

```bash
# In a secure environment with DATABASE_URL set:
SECRETS_VAULT_KEY=<OLD_KEY> NEW_KEY=<NEW_KEY> npx tsx -e '
import { rotateKey } from "./backend/src/services/secretsVault.js";
const r = await rotateKey(process.env.SECRETS_VAULT_KEY, process.env.NEW_KEY);
console.log(JSON.stringify(r));
'
```

Expected output:

```json
{ "rowsRotated": 42 }
```

The transaction commits only if every row was successfully decrypted with the old key and re-encrypted with the new key. On failure, ROLLBACK ensures no partial state.

An `audit_log` entry with action `secret.rotated` and `details.newFingerprint` is written by `secretsVault.rotateKey`.

### 5. Deploy the new key

1. Update `SECRETS_VAULT_KEY` in the Render / Nexus secret panel to the new value.
2. Trigger a redeploy (or pod restart) so the app reloads env.
3. Confirm in startup logs that the new fingerprint is loaded:

```
Secrets vault configured { "keyFingerprint": "<NEW_FP>", "keyLengthBytes": 64 }
```

4. Hit `GET /api/health/detailed` and confirm `services.secretsVault == "configured"`.

### 6. Smoke-test

Pick a known user who has a secret. As that user (or via admin SQL):

```sql
SELECT pgp_sym_decrypt(encrypted_value, '<NEW_KEY>') FROM cohen_mcleod.user_secrets WHERE user_id = '<ID>' AND label = 'github_token';
```

If decryption fails, **STOP** and roll back to the old key in env. Investigate why the rotation transaction succeeded but live decryption fails (likely an env-variable formatting issue).

### 7. Destroy the old key

After 7 days with no incidents:

- Delete the old key from any password manager / secure note.
- Confirm no `audit_log` decrypt errors over the period.

The old key has no remaining utility — every ciphertext was re-encrypted.

## Recovery: failed rotation

If step 4 fails partway:

- The rotation runs in a single `transaction()` block (`backend/src/services/secretsVault.ts:rotateKey`). A failure mid-transaction triggers ROLLBACK; no rows are partially re-encrypted.
- Diagnose the failure cause (likely: wrong old key, or a row corrupted by a prior incident).
- Fix and rerun.

## Recovery: app boots with wrong key

Symptom: `getSecret` throws `SecretDecryptError` for every label.

1. Verify the env value in the secret panel matches what you intended.
2. Check the startup log fingerprint — does it match the fingerprint you recorded post-rotation?
3. If they differ, restore the matching key value and redeploy.

## Audit checkpoints

After every rotation:

- `audit_log` contains exactly one `secret.rotated` entry from the rotation timestamp.
- `audit_log` should NOT contain a flurry of `secret.accessed` failures in the hour following.
- The new fingerprint is logged on every backend restart for as long as the new key is current.
