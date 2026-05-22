/**
 * Route-level tests for the OpenAPI spec + Swagger UI endpoints.
 *
 * Both routes are unauthenticated. The spec endpoint must return a valid
 * JSON document; the docs endpoint must return an HTML page that references
 * the spec endpoint and pins the Swagger UI CDN.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

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

import openapiRouter from "../openapi.js";

function makeApp(): express.Express {
  const app = express();
  app.use("/api", openapiRouter);
  return app;
}

describe("GET /api/openapi.json", () => {
  it("returns 200 with application/json", async () => {
    const res = await request(makeApp()).get("/api/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("body is a valid OpenAPI 3.1 document", async () => {
    const res = await request(makeApp()).get("/api/openapi.json");
    const spec = res.body as Record<string, unknown>;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toBeTruthy();
    expect(spec.paths).toBeTruthy();
    expect(spec.components).toBeTruthy();
    expect(spec.tags).toBeTruthy();
    expect(spec.servers).toBeTruthy();
  });

  it("info.title and version are populated", async () => {
    const res = await request(makeApp()).get("/api/openapi.json");
    const info = (res.body as { info: { title: string; version: string } }).info;
    expect(info.title).toBe("ABC Agent Builder Console API");
    expect(typeof info.version).toBe("string");
    expect(info.version.length).toBeGreaterThan(0);
  });

  it("describes the docs endpoint itself (self-discovery)", async () => {
    const res = await request(makeApp()).get("/api/openapi.json");
    const paths = (res.body as { paths: Record<string, unknown> }).paths;
    expect(paths["/api/openapi.json"]).toBeTruthy();
    expect(paths["/api/docs"]).toBeTruthy();
  });

  it("sets a short cache header so changes propagate quickly", async () => {
    const res = await request(makeApp()).get("/api/openapi.json");
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
  });
});

describe("GET /api/docs", () => {
  it("returns 200 with text/html", async () => {
    const res = await request(makeApp()).get("/api/docs");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it("references the OpenAPI spec endpoint", async () => {
    const res = await request(makeApp()).get("/api/docs");
    expect(res.text).toContain("/api/openapi.json");
  });

  it("loads Swagger UI from the pinned CDN", async () => {
    const res = await request(makeApp()).get("/api/docs");
    expect(res.text).toContain("cdn.jsdelivr.net/npm/swagger-ui-dist@5/");
    expect(res.text).toContain("swagger-ui.css");
    expect(res.text).toContain("swagger-ui-bundle.js");
  });

  it("sets a per-response CSP that allows the CDN", async () => {
    const res = await request(makeApp()).get("/api/docs");
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("https://cdn.jsdelivr.net");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("renders a #swagger-ui mount point", async () => {
    const res = await request(makeApp()).get("/api/docs");
    expect(res.text).toContain('id="swagger-ui"');
  });

  it("disables tryItOutEnabled by default", async () => {
    const res = await request(makeApp()).get("/api/docs");
    expect(res.text).toMatch(/tryItOutEnabled:\s*false/);
  });
});
