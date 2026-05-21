/**
 * Unit tests for the secretsVault service.
 *
 * All database calls are mocked via vi.hoisted — no live DB or pgcrypto needed.
 * Tests verify:
 *  - VaultNotConfigured is thrown when SECRETS_VAULT_KEY is absent
 *  - SecretDecryptError is thrown on key mismatch / null decrypt result
 *  - setSecret validates label and plaintext length constraints
 *  - getSecret returns null when no row exists; re-throws SecretDecryptError
 *  - listLabels, deleteSecret, rotateKey behave correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
  transaction: transactionMock,
}));

const auditActionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/auditLogger.js", () => ({
  auditAction: auditActionMock,
  AuditAction: {
    SECRET_CREATED: "secret.created",
    SECRET_UPDATED: "secret.updated",
    SECRET_ACCESSED: "secret.accessed",
    SECRET_DELETED: "secret.deleted",
    SECRET_ROTATED: "secret.rotated",
  },
}));

vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mutable env — configure per test
const envMock = vi.hoisted(() => ({
  SECRETS_VAULT_KEY: "a-test-key-that-is-at-least-32-bytes-long!",
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  VaultNotConfigured,
  SecretDecryptError,
  setSecret,
  getSecret,
  listLabels,
  deleteSecret,
  rotateKey,
  logVaultFingerprint,
} from "../secretsVault.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  auditActionMock.mockReset();
  envMock.SECRETS_VAULT_KEY = "a-test-key-that-is-at-least-32-bytes-long!";
});

// ---------------------------------------------------------------------------
// Error class shapes
// ---------------------------------------------------------------------------

describe("VaultNotConfigured", () => {
  it("is an instance of Error with correct name", () => {
    const err = new VaultNotConfigured();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VaultNotConfigured");
    expect(err.message).toMatch(/SECRETS_VAULT_KEY/);
  });
});

describe("SecretDecryptError", () => {
  it("includes the label in the message", () => {
    const err = new SecretDecryptError("github_token");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SecretDecryptError");
    expect(err.message).toMatch(/github_token/);
  });
});

// ---------------------------------------------------------------------------
// logVaultFingerprint
// ---------------------------------------------------------------------------

describe("logVaultFingerprint", () => {
  it("does not throw when key is configured", () => {
    expect(() => logVaultFingerprint()).not.toThrow();
  });

  it("does not throw when key is absent", () => {
    envMock.SECRETS_VAULT_KEY = "";
    expect(() => logVaultFingerprint()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setSecret
// ---------------------------------------------------------------------------

describe("setSecret — VaultNotConfigured guard", () => {
  it("throws VaultNotConfigured when key is not set", async () => {
    envMock.SECRETS_VAULT_KEY = "";
    await expect(setSecret("u-1", "api_key", "secret-value")).rejects.toBeInstanceOf(
      VaultNotConfigured
    );
  });
});

describe("setSecret — input validation", () => {
  it("throws when label is empty", async () => {
    await expect(setSecret("u-1", "", "value")).rejects.toThrow(/label/i);
  });

  it("throws when label exceeds 100 chars", async () => {
    const longLabel = "x".repeat(101);
    await expect(setSecret("u-1", longLabel, "value")).rejects.toThrow(/label/i);
  });

  it("throws when plaintext is empty", async () => {
    await expect(setSecret("u-1", "api_key", "")).rejects.toThrow(/plaintext/i);
  });

  it("throws when plaintext exceeds 10000 chars", async () => {
    const longVal = "x".repeat(10001);
    await expect(setSecret("u-1", "api_key", longVal)).rejects.toThrow(/plaintext/i);
  });
});

describe("setSecret — successful insert", () => {
  it("calls query with INSERT … ON CONFLICT upsert and calls auditAction for new rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ inserted: true }], rowCount: 1 });

    await setSecret("u-1", "github_token", "ghp_abc123");

    expect(queryMock).toHaveBeenCalledOnce();
    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain("INSERT INTO user_secrets");
    expect(sql).toContain("ON CONFLICT");
    // auditAction called with SECRET_CREATED
    expect(auditActionMock).toHaveBeenCalledOnce();
    expect(auditActionMock.mock.calls[0][1]).toBe("secret.created");
  });

  it("audits SECRET_UPDATED when the upsert updates an existing row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ inserted: false }], rowCount: 1 });

    await setSecret("u-1", "github_token", "ghp_new");

    expect(auditActionMock.mock.calls[0][1]).toBe("secret.updated");
  });
});

// ---------------------------------------------------------------------------
// getSecret
// ---------------------------------------------------------------------------

describe("getSecret — VaultNotConfigured guard", () => {
  it("throws VaultNotConfigured when key is not set", async () => {
    envMock.SECRETS_VAULT_KEY = "";
    await expect(getSecret("u-1", "api_key")).rejects.toBeInstanceOf(VaultNotConfigured);
  });
});

describe("getSecret — not found", () => {
  it("returns null when no row exists", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await getSecret("u-1", "missing_key");
    expect(result).toBeNull();
  });
});

describe("getSecret — decrypt error", () => {
  it("throws SecretDecryptError when the decrypted value is null", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ value: null }], rowCount: 1 });

    await expect(getSecret("u-1", "corrupt_key")).rejects.toBeInstanceOf(SecretDecryptError);
  });

  it("throws SecretDecryptError when pgcrypto returns a 'Wrong key' error", async () => {
    queryMock.mockRejectedValueOnce(new Error("Wrong key or corrupt data"));

    await expect(getSecret("u-1", "rotated_key")).rejects.toBeInstanceOf(SecretDecryptError);
  });

  it("re-throws unrelated DB errors unchanged", async () => {
    const dbErr = new Error("Connection timeout");
    queryMock.mockRejectedValueOnce(dbErr);

    await expect(getSecret("u-1", "some_key")).rejects.toThrow("Connection timeout");
  });
});

describe("getSecret — success", () => {
  it("returns the decrypted plaintext value", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ value: "super-secret" }], rowCount: 1 });

    const result = await getSecret("u-1", "api_key");
    expect(result).toBe("super-secret");
  });

  it("calls auditAction with SECRET_ACCESSED on successful read", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ value: "token-xyz" }], rowCount: 1 });

    await getSecret("u-1", "api_key");
    expect(auditActionMock).toHaveBeenCalledOnce();
    expect(auditActionMock.mock.calls[0][1]).toBe("secret.accessed");
  });
});

// ---------------------------------------------------------------------------
// listLabels
// ---------------------------------------------------------------------------

describe("listLabels", () => {
  it("throws VaultNotConfigured when key is not set", async () => {
    envMock.SECRETS_VAULT_KEY = "";
    await expect(listLabels("u-1")).rejects.toBeInstanceOf(VaultNotConfigured);
  });

  it("returns an array of label strings", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ label: "api_key" }, { label: "github_token" }],
      rowCount: 2,
    });

    const labels = await listLabels("u-1");
    expect(labels).toEqual(["api_key", "github_token"]);
  });

  it("returns an empty array when no secrets exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const labels = await listLabels("u-1");
    expect(labels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteSecret
// ---------------------------------------------------------------------------

describe("deleteSecret", () => {
  it("throws VaultNotConfigured when key is not set", async () => {
    envMock.SECRETS_VAULT_KEY = "";
    await expect(deleteSecret("u-1", "api_key")).rejects.toBeInstanceOf(VaultNotConfigured);
  });

  it("returns false and does not audit when no row was deleted", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const deleted = await deleteSecret("u-1", "nonexistent");
    expect(deleted).toBe(false);
    expect(auditActionMock).not.toHaveBeenCalled();
  });

  it("returns true and audits SECRET_DELETED when a row was deleted", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const deleted = await deleteSecret("u-1", "api_key");
    expect(deleted).toBe(true);
    expect(auditActionMock).toHaveBeenCalledOnce();
    expect(auditActionMock.mock.calls[0][1]).toBe("secret.deleted");
  });
});

// ---------------------------------------------------------------------------
// rotateKey
// ---------------------------------------------------------------------------

describe("rotateKey", () => {
  it("throws when newKey is shorter than 32 bytes", async () => {
    await expect(rotateKey("old-key", "short")).rejects.toThrow(/32 bytes/);
  });

  it("calls transaction callback and returns rowsRotated", async () => {
    const newKey = "n".repeat(32);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 7 }),
    };
    transactionMock.mockImplementation(async (cb: (client: unknown) => Promise<unknown>) =>
      cb(mockClient)
    );

    const result = await rotateKey("old-key-here-long-enough", newKey);
    expect(result.rowsRotated).toBe(7);
    expect(mockClient.query).toHaveBeenCalledOnce();
    const sql: string = mockClient.query.mock.calls[0][0];
    expect(sql).toContain("pgp_sym_encrypt");
    expect(sql).toContain("pgp_sym_decrypt");
  });

  it("calls auditAction with SECRET_ROTATED after rotation", async () => {
    const newKey = "n".repeat(32);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 3 }),
    };
    transactionMock.mockImplementation(async (cb: (client: unknown) => Promise<unknown>) =>
      cb(mockClient)
    );

    await rotateKey("old-key-here-long-enough", newKey);
    expect(auditActionMock).toHaveBeenCalledOnce();
    expect(auditActionMock.mock.calls[0][1]).toBe("secret.rotated");
  });
});
