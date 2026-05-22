import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const checkConnectionMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  checkConnection: checkConnectionMock,
}));

import healthRouter from "../health.js";

function makeApp(): express.Express {
  const app = express();
  app.use("/api/health", healthRouter);
  return app;
}

beforeEach(() => {
  checkConnectionMock.mockReset();
});

describe("GET /api/health", () => {
  it("returns 200 + healthy when the DB is connected", async () => {
    checkConnectionMock.mockResolvedValueOnce(true);
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.services.database).toBe("connected");
  });

  it("returns 503 + degraded when the DB is disconnected", async () => {
    checkConnectionMock.mockResolvedValueOnce(false);
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.database).toBe("disconnected");
  });

  it("reports configuration status for authentication and llm providers", async () => {
    checkConnectionMock.mockResolvedValueOnce(true);
    const res = await request(makeApp()).get("/api/health");
    expect(res.body.services).toHaveProperty("authentication");
    expect(res.body.services).toHaveProperty("llm");
  });
});

describe("GET /api/health/live", () => {
  it("always returns 200 + alive, even when the DB is down", async () => {
    checkConnectionMock.mockResolvedValueOnce(false);
    const res = await request(makeApp()).get("/api/health/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
    expect(res.body).toHaveProperty("uptimeSeconds");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(res.body).toHaveProperty("version");
  });

  it("does not call the DB at all (liveness probes must not depend on downstream)", async () => {
    await request(makeApp()).get("/api/health/live");
    expect(checkConnectionMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/health/ready", () => {
  it("returns 200 + ready when the DB is reachable", async () => {
    checkConnectionMock.mockResolvedValueOnce(true);
    const res = await request(makeApp()).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("returns 503 + not_ready with a database_disconnected reason when the DB is down", async () => {
    checkConnectionMock.mockResolvedValueOnce(false);
    const res = await request(makeApp()).get("/api/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.reason).toBe("database_disconnected");
  });
});
