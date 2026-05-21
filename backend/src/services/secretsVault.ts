/**
 * Secrets Vault — per-user encrypted secret store
 *
 * Encrypts arbitrary plaintext (API tokens, OAuth refresh tokens, tool
 * credentials) at rest using PostgreSQL's pgcrypto extension with symmetric
 * key encryption (`pgp_sym_encrypt`). The key (`SECRETS_VAULT_KEY`) is loaded
 * once from environment at boot; we never store it in the database.
 *
 * Integration point (Stream D): tool implementations that need a per-user
 * credential should call `getSecret(userId, label)` — e.g.
 *   const ghToken = await getSecret(userId, "github_token");
 * Returns `null` when the secret is not set; throws `SecretDecryptError`
 * if the ciphertext fails to decrypt with the current key (indicates
 * key drift or corruption).
 *
 * Key rotation: see `rotateKey(oldKey, newKey)` and the runbook in
 * `docs/operations/key_rotation.md`.
 *
 * Compliance notes:
 *  - Plaintext is never persisted, never logged, never returned in audit
 *    entries (label only).
 *  - The key fingerprint (first 8 hex chars of SHA-256) is logged at boot
 *    so operations can confirm which key version is in effect without
 *    leaking it.
 *  - The vault refuses to operate if `SECRETS_VAULT_KEY` is unset; methods
 *    throw `VaultNotConfigured` rather than silently degrading.
 */

import crypto from "node:crypto";
import { query, transaction } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { auditAction, AuditAction } from "./auditLogger.js";

export class VaultNotConfigured extends Error {
  constructor() {
    super("Secrets vault is not configured. Set SECRETS_VAULT_KEY (>=32 bytes).");
    this.name = "VaultNotConfigured";
  }
}

export class SecretDecryptError extends Error {
  constructor(label: string) {
    super(`Failed to decrypt secret '${label}'. Key may be rotated or value corrupted.`);
    this.name = "SecretDecryptError";
  }
}

function requireKey(): string {
  if (!env.SECRETS_VAULT_KEY) {
    throw new VaultNotConfigured();
  }
  return env.SECRETS_VAULT_KEY;
}

function fingerprint(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/**
 * Log the loaded key fingerprint at boot. Safe to log — fingerprint is a
 * one-way hash prefix, not the key itself. Helps ops correlate which key
 * version is loaded when rotating.
 */
export function logVaultFingerprint(): void {
  if (env.SECRETS_VAULT_KEY) {
    logger.info("Secrets vault configured", {
      keyFingerprint: fingerprint(env.SECRETS_VAULT_KEY),
      keyLengthBytes: env.SECRETS_VAULT_KEY.length,
    });
  } else {
    logger.warn("Secrets vault NOT configured. Tools requiring per-user secrets will fail. Set SECRETS_VAULT_KEY.");
  }
}

/**
 * Store (or update) an encrypted secret for a user.
 * Upserts on (user_id, label) — calling twice with the same label replaces.
 */
export async function setSecret(
  userId: string,
  label: string,
  plaintext: string
): Promise<void> {
  const key = requireKey();
  if (!label || label.length > 100) {
    throw new Error("Secret label must be 1-100 chars.");
  }
  if (!plaintext || plaintext.length > 10000) {
    throw new Error("Secret plaintext must be 1-10000 chars.");
  }

  await query(
    `INSERT INTO user_secrets (user_id, label, encrypted_value)
     VALUES ($1, $2, pgp_sym_encrypt($3, $4))
     ON CONFLICT (user_id, label)
     DO UPDATE SET encrypted_value = pgp_sym_encrypt($3, $4), updated_at = NOW()`,
    [userId, label, plaintext, key]
  );

  auditAction(userId, AuditAction.SECRET_CREATED, "user_secret", label);
}

/**
 * Retrieve a secret for a user. Returns null if not set.
 * Throws `SecretDecryptError` if the row exists but cannot be decrypted
 * (e.g. key rotated without re-encryption).
 */
export async function getSecret(
  userId: string,
  label: string
): Promise<string | null> {
  const key = requireKey();

  try {
    const result = await query<{ value: string | null }>(
      `SELECT pgp_sym_decrypt(encrypted_value, $1) AS value
       FROM user_secrets
       WHERE user_id = $2 AND label = $3`,
      [key, userId, label]
    );

    if (result.rowCount === 0) return null;
    const value = result.rows[0]?.value;
    if (value === null || value === undefined) {
      throw new SecretDecryptError(label);
    }

    auditAction(userId, AuditAction.SECRET_ACCESSED, "user_secret", label);
    return value;
  } catch (err) {
    if (err instanceof SecretDecryptError) throw err;
    const msg = (err as Error).message || "";
    if (msg.includes("Wrong key") || msg.includes("decrypt")) {
      throw new SecretDecryptError(label);
    }
    throw err;
  }
}

/**
 * List the labels of all secrets stored for a user (no values).
 */
export async function listLabels(userId: string): Promise<string[]> {
  requireKey();
  const result = await query<{ label: string }>(
    `SELECT label FROM user_secrets WHERE user_id = $1 ORDER BY label`,
    [userId]
  );
  return result.rows.map((r) => r.label);
}

/**
 * Delete a secret. No-op if it doesn't exist.
 */
export async function deleteSecret(
  userId: string,
  label: string
): Promise<boolean> {
  requireKey();
  const result = await query(
    `DELETE FROM user_secrets WHERE user_id = $1 AND label = $2`,
    [userId, label]
  );

  const deleted = (result.rowCount ?? 0) > 0;
  if (deleted) {
    auditAction(userId, AuditAction.SECRET_DELETED, "user_secret", label);
  }
  return deleted;
}

/**
 * Rotate the symmetric key.
 *
 * Decrypts every secret with `oldKey` and re-encrypts with `newKey` in a
 * single transaction (atomic — either all rows are migrated or none).
 *
 * IMPORTANT: After a successful rotation, redeploy with `SECRETS_VAULT_KEY=newKey`.
 * If the application is still using the old key when this returns, the next
 * `getSecret` call will throw `SecretDecryptError`.
 *
 * See docs/operations/key_rotation.md.
 */
export async function rotateKey(oldKey: string, newKey: string): Promise<{ rowsRotated: number }> {
  if (newKey.length < 32) {
    throw new Error("New key must be at least 32 bytes.");
  }

  return await transaction(async (client) => {
    const result = await client.query(
      `UPDATE user_secrets
       SET encrypted_value = pgp_sym_encrypt(pgp_sym_decrypt(encrypted_value, $1), $2),
           updated_at = NOW()`,
      [oldKey, newKey]
    );

    logger.info("Secrets vault key rotated", {
      rowsRotated: result.rowCount ?? 0,
      oldFingerprint: fingerprint(oldKey),
      newFingerprint: fingerprint(newKey),
    });

    auditAction(
      "system",
      AuditAction.SECRET_ROTATED,
      "user_secrets",
      undefined,
      { rowsRotated: result.rowCount ?? 0, newFingerprint: fingerprint(newKey) }
    );

    return { rowsRotated: result.rowCount ?? 0 };
  });
}
