/**
 * Unit tests for the programmatic OpenAPI 3.1 spec.
 *
 * These tests are deliberately structural rather than schema-conformance —
 * they pin the contract a consumer sees (every production route is present,
 * shared schemas exist, securitySchemes are correct, auth-free routes
 * advertise `security: []`). Spec linting against the official OpenAPI 3.1
 * meta-schema is a follow-up if we add a dev dependency for it.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import { buildOpenApiSpec, listSpecPaths } from "../spec.js";

const SPEC = buildOpenApiSpec({ version: "1.0.0" });

describe("OpenAPI spec — top-level shape", () => {
  it("declares openapi 3.1.0", () => {
    expect(SPEC.openapi).toBe("3.1.0");
  });

  it("has the correct title and version", () => {
    expect(SPEC.info.title).toBe("ABC Agent Builder Console API");
    expect(SPEC.info.version).toBe("1.0.0");
  });

  it("includes a contact and a license", () => {
    expect(SPEC.info.contact?.email).toBeTruthy();
    expect(SPEC.info.license?.name).toBeTruthy();
  });

  it("advertises at least the configured server + same-origin", () => {
    expect(SPEC.servers.length).toBeGreaterThanOrEqual(2);
    expect(SPEC.servers.some((s) => s.url === "/")).toBe(true);
  });

  it("uses the FRONTEND_URL env var as the configured server URL", () => {
    expect(SPEC.servers[0].url).toBe("http://localhost:5173");
  });

  it("honours an explicit publicUrl override", () => {
    const overridden = buildOpenApiSpec({ version: "1.0.0", publicUrl: "https://abc.example.com" });
    expect(overridden.servers[0].url).toBe("https://abc.example.com");
  });
});

describe("OpenAPI spec — paths", () => {
  const paths = listSpecPaths();

  it("covers every production route family", () => {
    const expected = [
      // Health
      "/api/health",
      "/api/health/live",
      "/api/health/ready",
      "/api/health/detailed",
      // Metrics
      "/api/metrics",
      // Auth
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/logout",
      "/api/auth/me",
      // Users
      "/api/users/me/preferences",
      "/api/users/me/saved-prompts",
      "/api/users/me/saved-prompts/{id}",
      "/api/users/me/favorite-workflows",
      "/api/users/me/favorite-workflows/{workflowId}",
      "/api/users/me/recent-workflow-executions",
      "/api/users/me/recent-sessions",
      "/api/users/me/secrets",
      "/api/users/me/secrets/{label}",
      "/api/users/me/budget",
      // Agent
      "/api/agent/sessions",
      "/api/agent/sessions/{id}",
      "/api/agent/sessions/{id}/start",
      "/api/agent/sessions/{id}/stop",
      "/api/agent/sessions/{id}/continue",
      "/api/agent/sessions/{id}/interject",
      "/api/agent/sessions/{id}/iterations",
      "/api/agent/sessions/{id}/artifacts",
      "/api/agent/sessions/{id}/artifacts/{artifactId}",
      "/api/agent/sessions/{id}/export",
      "/api/agent/prompt-template",
      "/api/agent/models",
      // Workflow
      "/api/workflows",
      "/api/workflows/library",
      "/api/workflows/{id}",
      "/api/workflows/{id}/duplicate",
      "/api/workflows/{id}/execute",
      "/api/workflows/{id}/estimate",
      "/api/workflows/{id}/versions",
      "/api/workflows/{id}/versions/{version}",
      "/api/workflows/{id}/versions/{version}/restore",
      "/api/workflows/{id}/executions",
      "/api/workflows/{id}/executions/{executionId}",
      "/api/workflows/{id}/executions/{executionId}/stop",
      "/api/workflows/{id}/executions/{executionId}/artifacts",
      "/api/workflows/{id}/executions/{executionId}/artifacts/{artifactId}",
      // Admin
      "/api/admin/audit",
      "/api/admin/audit/export.csv",
      "/api/admin/pii-detections",
      "/api/admin/models",
      "/api/admin/models/{id}",
      "/api/admin/sessions",
      "/api/admin/workflow-executions",
      "/api/admin/retention/run",
      "/api/admin/workflows/trash",
      "/api/admin/workflows/{id}/restore",
      "/api/admin/workflows/{id}/purge",
      "/api/admin/dashboard",
      "/api/admin/users/{id}/export",
      "/api/admin/budgets",
      "/api/admin/budgets/{scopeType}/{scopeId}",
      "/api/admin/budgets/usage",
      // Meta
      "/api/openapi.json",
      "/api/docs",
    ];
    for (const route of expected) {
      expect(paths).toContain(route);
    }
  });

  it("never advertises the MOCK_LLM-gated test routes", () => {
    expect(paths.every((p) => !p.startsWith("/api/test"))).toBe(true);
  });

  it("every path has at least one operation", () => {
    for (const [pathKey, pathItem] of Object.entries(SPEC.paths)) {
      const ops = (["get", "post", "put", "delete", "patch"] as const).filter(
        (m) => pathItem[m],
      );
      expect(ops.length, `${pathKey} must declare at least one HTTP method`).toBeGreaterThan(0);
    }
  });

  it("operations all have a 200/201/204/302 success response declared", () => {
    for (const [pathKey, pathItem] of Object.entries(SPEC.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const op = pathItem[method];
        if (!op) continue;
        const responseCodes = Object.keys(op.responses);
        const hasSuccess = responseCodes.some((code) =>
          ["200", "201", "204", "302"].includes(code),
        );
        expect(hasSuccess, `${method.toUpperCase()} ${pathKey} must declare a success response`).toBe(
          true,
        );
      }
    }
  });

  it("every operation has a unique operationId", () => {
    const ids = new Set<string>();
    for (const pathItem of Object.values(SPEC.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const op = pathItem[method];
        if (!op?.operationId) continue;
        expect(ids.has(op.operationId), `duplicate operationId: ${op.operationId}`).toBe(false);
        ids.add(op.operationId);
      }
    }
    // Sanity floor — we should be in the tens of operations at minimum.
    expect(ids.size).toBeGreaterThan(20);
  });
});

describe("OpenAPI spec — components and security", () => {
  it("declares the cookieAuth security scheme", () => {
    const schemes = SPEC.components.securitySchemes;
    expect(schemes).toBeDefined();
    expect(schemes?.cookieAuth).toBeDefined();
    const cookieAuth = schemes?.cookieAuth;
    if (cookieAuth?.type === "apiKey") {
      expect(cookieAuth.in).toBe("cookie");
      expect(cookieAuth.name).toBe("abc_session");
    } else {
      throw new Error("cookieAuth must be an apiKey scheme");
    }
  });

  it("declares the shared schemas", () => {
    const required = [
      "Classification",
      "ApiError",
      "Workflow",
      "WorkflowSummary",
      "CanvasData",
      "CanvasNode",
      "CanvasEdge",
      "AgentSession",
      "AgentIteration",
      "UserPreferences",
      "SavedPrompt",
      "AuditEvent",
      "HealthReport",
      "WorkflowCostEstimate",
    ];
    for (const name of required) {
      expect(SPEC.components.schemas?.[name], `missing schema: ${name}`).toBeDefined();
    }
  });

  it("Classification enum lists exactly the three GoA values", () => {
    const cls = SPEC.components.schemas?.Classification;
    expect(cls?.enum).toEqual(["unclassified", "protected_a", "protected_b"]);
  });

  it("auth-free routes have security: []", () => {
    const publicRoutes = [
      ["/api/health", "get"],
      ["/api/health/live", "get"],
      ["/api/health/ready", "get"],
      ["/api/auth/login", "get"],
      ["/api/auth/callback", "get"],
      ["/api/openapi.json", "get"],
      ["/api/docs", "get"],
    ] as const;
    for (const [pathKey, method] of publicRoutes) {
      const op = SPEC.paths[pathKey]?.[method as "get"];
      expect(op, `${method} ${pathKey} missing`).toBeDefined();
      expect(op?.security, `${method} ${pathKey} should be public`).toEqual([]);
    }
  });

  it("authenticated routes require cookieAuth", () => {
    const protectedRoutes = [
      ["/api/auth/me", "get"],
      ["/api/auth/logout", "post"],
      ["/api/users/me/preferences", "get"],
      ["/api/users/me/preferences", "put"],
      ["/api/agent/sessions", "post"],
      ["/api/workflows", "get"],
      ["/api/workflows", "post"],
      ["/api/admin/audit", "get"],
      ["/api/admin/users/{id}/export", "post"],
    ] as const;
    for (const [pathKey, method] of protectedRoutes) {
      const op = SPEC.paths[pathKey]?.[method as "get"];
      expect(op?.security?.some((s) => "cookieAuth" in s)).toBe(true);
    }
  });
});

describe("OpenAPI spec — tags", () => {
  it("declares a curated set of tag groups", () => {
    const tagNames = SPEC.tags.map((t) => t.name);
    expect(tagNames).toContain("Auth");
    expect(tagNames).toContain("Users");
    expect(tagNames).toContain("Agent");
    expect(tagNames).toContain("Workflow");
    expect(tagNames).toContain("Admin");
    expect(tagNames).toContain("Health");
    expect(tagNames).toContain("Observability");
    expect(tagNames).toContain("Meta");
  });

  it("every operation's tag references a declared tag", () => {
    const declared = new Set(SPEC.tags.map((t) => t.name));
    for (const pathItem of Object.values(SPEC.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const op = pathItem[method];
        if (!op?.tags) continue;
        for (const tag of op.tags) {
          expect(declared.has(tag), `undeclared tag: ${tag}`).toBe(true);
        }
      }
    }
  });
});
