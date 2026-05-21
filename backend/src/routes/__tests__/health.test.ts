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
