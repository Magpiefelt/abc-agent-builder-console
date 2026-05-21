/**
 * Route-level tests for /api/users/me/secrets.
 *
 * Scoped to the secrets vault HTTP API added on top of services/secretsVault.ts.
 * The vault module itself is mocked so we drive the success / validation /
 * VaultNotConfigured branches without touching pgcrypto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const setSecretMock = vi.hoisted(() => vi.fn());
const listLabelsMock = vi.hoisted(() => vi.fn());
const deleteSecretMock = vi.hoisted(() => vi.fn());
const VaultNotConfiguredCls = vi.hoisted(() => {
  return class VaultNotConfigured extends Error {
    constructor() {
      super("vault");
      this.name = "VaultNotConfigured";
    }
  };
});
vi.mock("../../services/secretsVault.js", () => ({
  setSecret: setSecretMock,
  listLabels: listLabelsMock,
  deleteSecret: deleteSecretMock,
  VaultNotConfigured: VaultNotConfiguredCls,
}));

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import userRouter from "../users.js";
import { authenticate } from "../../middleware/auth.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  // users routes are mounted with `authenticate` at the app level in index.ts.
  // The dev mock auth path activates because the env mock leaves
  // ENTRA_CLIENT_ID unset.
  app.use("/api/users", authenticate, userRouter);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  setSecretMock.mockReset();
  listLabelsMock.mockReset();
  deleteSecretMock.mockReset();
});

describe("GET /api/users/me/secrets", () => {
  it("returns the list of labels (no values) on success", async () => {
    listLabelsMock.mockResolvedValueOnce(["github_token", "openai_key"]);
    const res = await request(makeApp()).get("/api/users/me/secrets");
    expect(res.status).toBe(200);
    expect(res.body.labels).toEqual(["github_token", "openai_key"]);
  });

  it("returns 503 when the vault is not configured", async () => {
    listLabelsMock.mockRejectedValueOnce(new VaultNotConfiguredCls());
    const res = await request(makeApp()).get("/api/users/me/secrets");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("VAULT_NOT_CONFIGURED");
  });

  it("returns 500 on unexpected error", async () => {
    listLabelsMock.mockRejectedValueOnce(new Error("db down"));
    const res = await request(makeApp()).get("/api/users/me/secrets");
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/users/me/secrets/:label", () => {
  it("rejects an invalid label with 400", async () => {
    const res = await request(makeApp())
      .put("/api/users/me/secrets/has spaces")
      .send({ value: "x" });
    expect(res.status).toBe(400);
    expect(setSecretMock).not.toHaveBeenCalled();
  });

  it("rejects an empty value with 400", async () => {
    const res = await request(makeApp())
      .put("/api/users/me/secrets/github_token")
      .send({ value: "" });
    expect(res.status).toBe(400);
    expect(setSecretMock).not.toHaveBeenCalled();
  });

  it("rejects a too-long value with 400", async () => {
    const res = await request(makeApp())
      .put("/api/users/me/secrets/github_token")
      .send({ value: "x".repeat(10_001) });
    expect(res.status).toBe(400);
  });

  it("stores the secret and returns 204 on success", async () => {
    setSecretMock.mockResolvedValueOnce(undefined);
    const res = await request(makeApp())
      .put("/api/users/me/secrets/github_token")
      .send({ value: "ghp_abc" });
    expect(res.status).toBe(204);
    expect(setSecretMock).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "github_token",
      "ghp_abc",
    );
  });

  it("returns 503 when the vault is not configured", async () => {
    setSecretMock.mockRejectedValueOnce(new VaultNotConfiguredCls());
    const res = await request(makeApp())
      .put("/api/users/me/secrets/github_token")
      .send({ value: "ghp_abc" });
    expect(res.status).toBe(503);
  });
});

describe("DELETE /api/users/me/secrets/:label", () => {
  it("rejects an invalid label with 400", async () => {
    const res = await request(makeApp()).delete(
      "/api/users/me/secrets/has spaces",
    );
    expect(res.status).toBe(400);
    expect(deleteSecretMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the label is not found", async () => {
    deleteSecretMock.mockResolvedValueOnce(false);
    const res = await request(makeApp()).delete(
      "/api/users/me/secrets/missing_label",
    );
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful delete", async () => {
    deleteSecretMock.mockResolvedValueOnce(true);
    const res = await request(makeApp()).delete(
      "/api/users/me/secrets/github_token",
    );
    expect(res.status).toBe(204);
  });

  it("returns 503 when the vault is not configured", async () => {
    deleteSecretMock.mockRejectedValueOnce(new VaultNotConfiguredCls());
    const res = await request(makeApp()).delete(
      "/api/users/me/secrets/github_token",
    );
    expect(res.status).toBe(503);
  });
});
