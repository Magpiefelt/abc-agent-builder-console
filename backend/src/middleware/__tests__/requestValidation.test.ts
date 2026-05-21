import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

import { requestValidation } from "../requestValidation.js";

function makeReq(
  opts: {
    method?: string;
    path?: string;
    originalUrl?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  return {
    method: opts.method || "GET",
    path: opts.path || "/api/agent/sessions",
    originalUrl: opts.originalUrl || opts.path || "/api/agent/sessions",
    headers: opts.headers || {},
    ip: "1.2.3.4",
    socket: { remoteAddress: "1.2.3.4" },
  } as unknown as Request;
}

type MockRes = Response & { _status: number; _body: unknown };

function makeRes(): MockRes {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(this: MockRes, code: number): MockRes {
      this._status = code;
      return this;
    },
    json(this: MockRes, body: unknown): MockRes {
      this._body = body;
      return this;
    },
  };
  return res as unknown as MockRes;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
});

describe("requestValidation — path traversal", () => {
  it("blocks ../ in the path", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({ path: "/api/agent/../../etc/passwd", originalUrl: "/api/agent/../../etc/passwd" }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks URL-encoded path traversal (%2e%2e) in the query string", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions?file=%2e%2e/%2e%2e/etc/passwd",
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
  });

  it("blocks null-byte injection (%00) in the query string", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions?file=foo%00.txt",
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
  });
});

describe("requestValidation — XSS / SQLi patterns", () => {
  it("blocks <script in the URL", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({ originalUrl: "/api/agent/sessions?q=<script>alert(1)</script>" }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
  });

  it("blocks UNION SELECT in the URL", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({ originalUrl: "/api/agent/sessions?q=1' UNION SELECT * from users" }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
  });

  it("blocks DROP TABLE in the URL", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({ originalUrl: "/api/agent/sessions?cmd=DROP%20TABLE%20users" }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
  });
});

describe("requestValidation — Content-Type enforcement", () => {
  it("rejects POST without a Content-Type header when a body is present", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        method: "POST",
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions",
        headers: { "content-length": "10" },
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(415);
  });

  it("rejects POST with an unsupported Content-Type", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        method: "POST",
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions",
        headers: { "content-type": "text/xml", "content-length": "10" },
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(415);
  });

  it("accepts POST with application/json", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        method: "POST",
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions",
        headers: { "content-type": "application/json", "content-length": "10" },
      }),
      res,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("requestValidation — payload size", () => {
  it("rejects oversized payloads (>5MB)", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        method: "POST",
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions",
        headers: { "content-type": "application/json", "content-length": String(6 * 1024 * 1024) },
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(413);
  });
});

describe("requestValidation — URL length cap", () => {
  it("rejects URLs longer than 2048 characters", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions?q=" + "x".repeat(2100),
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(414);
  });
});

describe("requestValidation — skip paths", () => {
  it("skips validation for /api/health", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({ path: "/api/health", originalUrl: "/api/health" }),
      res,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(200);
  });
});

describe("requestValidation — Host header smuggling", () => {
  it("rejects host headers containing '..' (potential bypass attempt)", () => {
    const next = vi.fn();
    const res = makeRes();
    requestValidation(
      makeReq({
        path: "/api/agent/sessions",
        originalUrl: "/api/agent/sessions",
        headers: { host: "example..com" },
      }),
      res,
      next as unknown as NextFunction
    );
    expect(res._status).toBe(400);
  });
});
