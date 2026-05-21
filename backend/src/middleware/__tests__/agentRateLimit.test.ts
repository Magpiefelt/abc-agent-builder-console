import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

import { agentRateLimit } from "../agentRateLimit.js";
import type { Request, Response, NextFunction } from "express";

function makeReq(method: string, path: string, ip = "1.2.3.4"): Request {
  return {
    method,
    path,
    ip,
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function makeRes(): Response & { _status: number; _body: unknown; _headers: Record<string, unknown> } {
  const res = {
    _status: 200,
    _body: null as unknown,
    _headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) {
      this._headers[k] = v;
      return this;
    },
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, unknown> };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  // The middleware skips rate limiting in development; ensure we test the real path.
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  process.env.NODE_ENV = "test";
});

describe("agentRateLimit — happy path", () => {
  it("allows requests under the limit", () => {
    const next = vi.fn();
    const res = makeRes();
    agentRateLimit(makeReq("POST", "/sessions"), res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(200);
    expect(res._headers["X-RateLimit-Limit"]).toBeDefined();
    expect(res._headers["X-RateLimit-Remaining"]).toBeDefined();
  });

  it("emits X-RateLimit-* headers on every successful request", () => {
    const res = makeRes();
    agentRateLimit(makeReq("GET", "/sessions/12345678-abcd-abcd-abcd-1234567890ab", "10.10.10.10"), res, vi.fn() as unknown as NextFunction);
    expect(res._headers["X-RateLimit-Limit"]).toBeDefined();
    expect(res._headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(res._headers["X-RateLimit-Reset"]).toBeDefined();
  });
});

describe("agentRateLimit — limit exhaustion", () => {
  it("returns 429 after exceeding the configured per-endpoint limit", () => {
    const ip = "8.8.8.8";
    const limit = 5; // POST:/sessions/start = 5/min

    let lastStatus = 200;
    for (let i = 0; i < limit + 2; i++) {
      const res = makeRes();
      const next = vi.fn();
      agentRateLimit(
        makeReq("POST", "/sessions/12345678-abcd-abcd-abcd-1234567890ab/start", ip),
        res,
        next as unknown as NextFunction
      );
      lastStatus = res._status;
    }
    expect(lastStatus).toBe(429);
  });

  it("includes Retry-After header on a 429 response", () => {
    const ip = "8.8.4.4";
    const res = makeRes();
    // Hammer enough requests to exceed POST:/sessions/start limit
    for (let i = 0; i < 10; i++) {
      const r = makeRes();
      agentRateLimit(makeReq("POST", "/sessions/12345678-abcd-abcd-abcd-1234567890ab/start", ip), r, vi.fn() as unknown as NextFunction);
    }
    agentRateLimit(makeReq("POST", "/sessions/12345678-abcd-abcd-abcd-1234567890ab/start", ip), res, vi.fn() as unknown as NextFunction);
    expect(res._status).toBe(429);
    expect(res._headers["Retry-After"]).toBeDefined();
  });
});

describe("agentRateLimit — dev mode bypass", () => {
  it("does not apply rate limits in development", () => {
    process.env.NODE_ENV = "development";
    const ip = "9.9.9.9";
    for (let i = 0; i < 100; i++) {
      const r = makeRes();
      const next = vi.fn();
      agentRateLimit(makeReq("POST", "/sessions/id/start", ip), r, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
    }
  });
});

describe("agentRateLimit — buckets", () => {
  it("read endpoints use a more permissive limit than write endpoints", () => {
    const ip = "7.7.7.7";
    let readLimit: number | undefined;
    let writeLimit: number | undefined;

    const r1 = makeRes();
    agentRateLimit(makeReq("GET", "/sessions/12345678-abcd-abcd-abcd-1234567890ab", ip), r1, vi.fn() as unknown as NextFunction);
    readLimit = r1._headers["X-RateLimit-Limit"] as number;

    const r2 = makeRes();
    agentRateLimit(makeReq("POST", "/sessions/12345678-abcd-abcd-abcd-1234567890ab/start", ip), r2, vi.fn() as unknown as NextFunction);
    writeLimit = r2._headers["X-RateLimit-Limit"] as number;

    expect(readLimit).toBeGreaterThan(writeLimit as number);
  });

  it("shares the bucket across different session IDs (no bypass by minting new UUIDs)", () => {
    // Regression: storeKey used to include the raw path, so a client could
    // hit /sessions/UUID-A/start until rate-limited and then switch to
    // /sessions/UUID-B/start and start over. The limit is per-endpoint, not
    // per-resource, so all UUIDs must share the same bucket.
    const ip = "11.22.33.44";
    const limitForStart = 5; // POST:/sessions/start
    let last200 = 0;
    let firstStatus = 0;

    for (let i = 0; i < limitForStart + 3; i++) {
      const uuid = `12345678-aaaa-bbbb-cccc-${i.toString().padStart(12, "0")}`;
      const res = makeRes();
      agentRateLimit(
        makeReq("POST", `/sessions/${uuid}/start`, ip),
        res,
        vi.fn() as unknown as NextFunction
      );
      if (firstStatus === 0) firstStatus = res._status;
      if (res._status === 200) last200 = i;
    }

    expect(firstStatus).toBe(200);
    // The 6th, 7th, 8th calls (i=5,6,7) must be denied — every UUID shares
    // the same bucket, so the limit caps at 5 successful starts.
    expect(last200).toBeLessThanOrEqual(limitForStart - 1);
  });
});
