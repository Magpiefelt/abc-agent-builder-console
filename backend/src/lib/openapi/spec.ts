/**
 * Programmatic OpenAPI 3.1 spec for the ABC Agent Builder Console API.
 *
 * `buildOpenApiSpec()` returns the complete document — no Express coupling
 * so the function can be exercised in unit tests directly. The
 * `routes/openapi.ts` module wraps this in HTTP responses.
 *
 * Maintenance rule: when you add a route under `backend/src/routes/`, add
 * its `PathItemObject` here too. The unit test in
 * `__tests__/spec.test.ts` pins the production route list — adding a
 * route without spec coverage makes the suite go red.
 */

import { env } from "../../config/env.js";
import type {
  OpenAPIObject,
  PathItemObject,
  SchemaObject,
  ResponseObject,
  ParameterObject,
} from "./types.js";

// ============================================================================
// SHARED RESPONSE / PARAMETER BUILDERS
// ============================================================================

const errorResponse = (description: string): ResponseObject => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
});

const noContentResponse = (description: string): ResponseObject => ({
  description,
});

const protectedSecurity = [{ cookieAuth: [] }];
const publicSecurity: never[] = [];

// Path parameters reused across many routes.
const idPathParam = (
  name: string,
  description: string,
  format: "uuid" | "int" | "string" = "uuid",
): ParameterObject => ({
  name,
  in: "path",
  required: true,
  description,
  schema:
    format === "uuid"
      ? { type: "string", format: "uuid" }
      : format === "int"
        ? { type: "integer", minimum: 1 }
        : { type: "string" },
});

// ============================================================================
// COMPONENT SCHEMAS
// ============================================================================

const schemas: Record<string, SchemaObject> = {
  // --- Shared primitives -----------------------------------------------------
  Classification: {
    type: "string",
    enum: ["unclassified", "protected_a", "protected_b"],
    description: "GoA information classification.",
  },

  ApiError: {
    type: "object",
    description: "Standard error response body.",
    required: ["error"],
    properties: {
      error: { type: "string", description: "Human-readable error message." },
      code: {
        type: "string",
        description: "Stable machine-readable error code, when applicable.",
      },
      detections: {
        type: "array",
        description: "Populated for 422 PII-block responses.",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
          },
        },
      },
    },
  },

  // --- Workflow --------------------------------------------------------------
  CanvasNode: {
    type: "object",
    description: "A single node in a workflow canvas.",
    required: ["id", "type", "position", "data"],
    properties: {
      id: { type: "string" },
      type: {
        type: "string",
        enum: ["agent", "function", "tool", "note"],
      },
      position: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
      },
      data: { type: "object", additionalProperties: true },
    },
  },

  CanvasEdge: {
    type: "object",
    description: "A directed edge between two canvas nodes.",
    required: ["id", "source", "target"],
    properties: {
      id: { type: "string" },
      source: { type: "string" },
      target: { type: "string" },
      sourceHandle: { type: "string" },
      targetHandle: { type: "string" },
      label: { type: "string" },
    },
  },

  CanvasData: {
    type: "object",
    description:
      "Workflow canvas payload. Persisted as JSONB on the `workflows` table.",
    required: ["nodes", "edges", "version"],
    properties: {
      nodes: { type: "array", items: { $ref: "#/components/schemas/CanvasNode" } },
      edges: { type: "array", items: { $ref: "#/components/schemas/CanvasEdge" } },
      version: { type: "integer", enum: [1] },
    },
  },

  WorkflowSummary: {
    type: "object",
    description:
      "Workflow row without the canvas payload — used in list responses.",
    required: [
      "id",
      "name",
      "classification",
      "version",
      "is_template",
      "user_id",
      "updated_at",
      "created_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      classification: { $ref: "#/components/schemas/Classification" },
      version: { type: "integer", minimum: 1 },
      is_template: { type: "boolean" },
      ministry_code: { type: "string", nullable: true },
      user_id: { type: "string", format: "uuid" },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  },

  Workflow: {
    type: "object",
    description: "Workflow row with the full canvas payload.",
    required: [
      "id",
      "name",
      "classification",
      "version",
      "is_template",
      "user_id",
      "canvas_data",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      classification: { $ref: "#/components/schemas/Classification" },
      version: { type: "integer", minimum: 1 },
      is_template: { type: "boolean" },
      ministry_code: { type: "string", nullable: true },
      user_id: { type: "string", format: "uuid" },
      canvas_data: { $ref: "#/components/schemas/CanvasData" },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  },

  WorkflowCostEstimate: {
    type: "object",
    description:
      "Pre-run cost estimate. Returned by `/api/workflows/:id/estimate`.",
    required: ["totalAgentCalls", "totalInputTokens", "totalOutputTokens", "totalCostUsd", "byNode"],
    properties: {
      totalAgentCalls: { type: "integer", minimum: 0 },
      totalInputTokens: { type: "integer", minimum: 0 },
      totalOutputTokens: { type: "integer", minimum: 0 },
      totalCostUsd: { type: "number", minimum: 0 },
      warnings: {
        type: "array",
        items: { type: "string" },
        description: "Free-text warnings (e.g. unknown model).",
      },
      byNode: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nodeId: { type: "string" },
            label: { type: "string" },
            kind: { type: "string", enum: ["agent", "function", "tool", "note"] },
            modelId: { type: "string", nullable: true },
            inputTokens: { type: "integer" },
            outputTokens: { type: "integer" },
            costUsd: { type: "number" },
          },
        },
      },
    },
  },

  // --- Agent sessions --------------------------------------------------------
  AgentSession: {
    type: "object",
    required: ["id", "userId", "prompt", "modelId", "classification", "status", "createdAt"],
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      ministryCode: { type: "string", nullable: true },
      prompt: { type: "string" },
      modelId: { type: "string" },
      classification: { $ref: "#/components/schemas/Classification" },
      status: {
        type: "string",
        enum: ["idle", "running", "paused", "needs_assistance", "completed", "error"],
      },
      currentIteration: { type: "integer", minimum: 0 },
      maxIterations: { type: "integer", minimum: 1 },
      starred: {
        type: "boolean",
        description: "User bookmark flag (Backlog F8).",
      },
      createdAt: { type: "string", format: "date-time" },
      completedAt: { type: "string", format: "date-time", nullable: true },
    },
  },

  AgentIteration: {
    type: "object",
    required: ["id", "sessionId", "iterationNumber", "status", "createdAt"],
    properties: {
      id: { type: "string", format: "uuid" },
      sessionId: { type: "string", format: "uuid" },
      iterationNumber: { type: "integer", minimum: 1 },
      status: {
        type: "string",
        enum: ["pending", "running", "completed", "error"],
      },
      thinking: { type: "string", nullable: true },
      message: { type: "string", nullable: true },
      toolCalls: { type: "array", items: { type: "object", additionalProperties: true } },
      toolResults: { type: "array", items: { type: "object", additionalProperties: true } },
      tokensUsed: { type: "integer", minimum: 0 },
      durationMs: { type: "integer", minimum: 0, nullable: true },
      pinned: {
        type: "boolean",
        description: "User-pinned highlight (Backlog F8).",
      },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  // --- User memory -----------------------------------------------------------
  UserPreferences: {
    type: "object",
    properties: {
      defaultModelId: { type: "string", nullable: true },
      defaultClassification: {
        oneOf: [
          { $ref: "#/components/schemas/Classification" },
          { type: "null" },
        ],
      },
      theme: { type: "string", enum: ["light", "dark", "system"] },
      notificationPreferences: { type: "object", additionalProperties: true },
      updatedAt: { type: "string", format: "date-time" },
    },
  },

  SavedPrompt: {
    type: "object",
    required: ["id", "title", "prompt", "isPublic", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string", format: "uuid" },
      title: { type: "string" },
      prompt: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      isPublic: { type: "boolean" },
      ministryCode: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },

  // --- Audit / admin ---------------------------------------------------------
  AuditEvent: {
    type: "object",
    required: ["id", "action", "createdAt"],
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid", nullable: true },
      ministryCode: { type: "string", nullable: true },
      action: { type: "string" },
      resourceType: { type: "string", nullable: true },
      resourceId: { type: "string", nullable: true },
      details: { type: "object", additionalProperties: true, nullable: true },
      ipAddress: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  // --- Health ----------------------------------------------------------------
  HealthReport: {
    type: "object",
    required: ["status", "timestamp"],
    properties: {
      status: { type: "string", enum: ["healthy", "degraded", "alive", "ready", "not_ready"] },
      timestamp: { type: "string", format: "date-time" },
      version: { type: "string" },
      environment: { type: "string" },
      uptimeSeconds: { type: "integer" },
      services: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      reason: { type: "string", description: "Populated when status is not_ready." },
    },
  },
};

// ============================================================================
// PATHS
// ============================================================================
//
// Each block keeps a path-item co-located with its handler so the diff is
// easy to review. Tags group operations in Swagger UI's left nav.
//
// Sort order: health, metrics, auth, users, agent, workflow, admin.
//
// All operation IDs are unique and use the verb + resource style that
// Swagger UI uses to name the client methods.

const paths: Record<string, PathItemObject> = {
  // --- Health ----------------------------------------------------------------
  "/api/health": {
    get: {
      tags: ["Health"],
      summary: "Public summary health check.",
      operationId: "healthSummary",
      security: publicSecurity,
      responses: {
        "200": {
          description: "Service is healthy.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthReport" },
            },
          },
        },
        "503": {
          description: "Service is degraded (e.g. DB unreachable).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthReport" },
            },
          },
        },
      },
    },
  },

  "/api/health/live": {
    get: {
      tags: ["Health"],
      summary: "Kubernetes liveness probe — always 200 when process is up.",
      operationId: "healthLive",
      security: publicSecurity,
      responses: {
        "200": {
          description: "Process is responsive.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthReport" },
            },
          },
        },
      },
    },
  },

  "/api/health/ready": {
    get: {
      tags: ["Health"],
      summary: "Kubernetes readiness probe — 200 only when DB is reachable.",
      operationId: "healthReady",
      security: publicSecurity,
      responses: {
        "200": {
          description: "Ready to serve traffic.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthReport" },
            },
          },
        },
        "503": {
          description: "Not ready (DB disconnected, etc.).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthReport" },
            },
          },
        },
      },
    },
  },

  "/api/health/detailed": {
    get: {
      tags: ["Health", "Admin"],
      summary: "Full diagnostic snapshot — admin only.",
      operationId: "healthDetailed",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Diagnostic snapshot.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  // --- Metrics ---------------------------------------------------------------
  "/api/metrics": {
    get: {
      tags: ["Observability"],
      summary: "Prometheus metrics scrape endpoint — admin only.",
      operationId: "metrics",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Prometheus text-format metrics.",
          content: {
            "text/plain": {
              schema: { type: "string" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  // --- Auth ------------------------------------------------------------------
  "/api/auth/login": {
    get: {
      tags: ["Auth"],
      summary: "Begin Entra ID OIDC PKCE flow — redirects to Microsoft.",
      operationId: "authLogin",
      security: publicSecurity,
      parameters: [
        {
          name: "returnTo",
          in: "query",
          required: false,
          description: "Path to return to after successful sign-in.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "302": { description: "Redirect to Microsoft authorize endpoint." },
        "503": errorResponse("Entra ID is not configured on this server."),
      },
    },
  },

  "/api/auth/callback": {
    get: {
      tags: ["Auth"],
      summary: "Entra ID OIDC callback — exchanges code, sets session cookie.",
      operationId: "authCallback",
      security: publicSecurity,
      parameters: [
        { name: "code", in: "query", required: false, schema: { type: "string" } },
        { name: "state", in: "query", required: false, schema: { type: "string" } },
        { name: "error", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: {
        "302": { description: "Redirect to frontend after success or failure." },
        "400": errorResponse("Missing or invalid OAuth parameters (JSON callers only)."),
        "401": errorResponse("Authentication failed (JSON callers only)."),
        "503": errorResponse("Entra ID not configured (JSON callers only)."),
      },
    },
  },

  "/api/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Clear session cookie.",
      operationId: "authLogout",
      security: protectedSecurity,
      responses: {
        "204": noContentResponse("Logged out."),
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Return the authenticated user.",
      operationId: "authMe",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Current user.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "email", "displayName", "role"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  entraId: { type: "string" },
                  email: { type: "string", format: "email" },
                  displayName: { type: "string" },
                  ministryCode: { type: "string", nullable: true },
                  role: { type: "string", enum: ["user", "admin"] },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  // --- Users -----------------------------------------------------------------
  "/api/users/me/preferences": {
    get: {
      tags: ["Users"],
      summary: "Read the caller's preferences.",
      operationId: "getUserPreferences",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "User preferences.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UserPreferences" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
    put: {
      tags: ["Users"],
      summary: "Upsert the caller's preferences.",
      operationId: "updateUserPreferences",
      security: protectedSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UserPreferences" },
          },
        },
      },
      responses: {
        "204": noContentResponse("Saved."),
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/users/me/saved-prompts": {
    get: {
      tags: ["Users"],
      summary: "List the caller's saved prompts (plus shared ministry prompts).",
      operationId: "listSavedPrompts",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Saved prompts list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["prompts"],
                properties: {
                  prompts: {
                    type: "array",
                    items: { $ref: "#/components/schemas/SavedPrompt" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
    post: {
      tags: ["Users"],
      summary: "Create a saved prompt.",
      operationId: "createSavedPrompt",
      security: protectedSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "prompt"],
              properties: {
                title: { type: "string", minLength: 1, maxLength: 200 },
                prompt: { type: "string", minLength: 1, maxLength: 50_000 },
                tags: { type: "array", items: { type: "string" } },
                isPublic: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Saved prompt created.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SavedPrompt" },
            },
          },
        },
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/users/me/saved-prompts/{id}": {
    delete: {
      tags: ["Users"],
      summary: "Delete one of the caller's saved prompts.",
      operationId: "deleteSavedPrompt",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Saved prompt id.")],
      responses: {
        "204": noContentResponse("Deleted."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Prompt not found."),
      },
    },
  },

  "/api/users/me/favorite-workflows": {
    get: {
      tags: ["Users"],
      summary: "List the caller's favourite workflows.",
      operationId: "listFavoriteWorkflows",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Favourite workflows.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  favorites: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WorkflowSummary" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/users/me/favorite-workflows/{workflowId}": {
    post: {
      tags: ["Users"],
      summary: "Mark a workflow as favourite.",
      operationId: "addFavoriteWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("workflowId", "Workflow id.")],
      responses: {
        "204": noContentResponse("Added (or already favourited)."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Workflow not found."),
      },
    },
    delete: {
      tags: ["Users"],
      summary: "Remove a workflow from favourites.",
      operationId: "removeFavoriteWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("workflowId", "Workflow id.")],
      responses: {
        "204": noContentResponse("Removed (or not previously favourited)."),
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/users/me/recent-workflow-executions": {
    get: {
      tags: ["Users"],
      summary: "Recent workflow executions for the caller.",
      operationId: "listRecentWorkflowExecutions",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Up to 20 most recent workflow executions.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  executions: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/users/me/recent-sessions": {
    get: {
      tags: ["Users"],
      summary: "Recent agent sessions for the caller.",
      operationId: "listRecentSessions",
      security: protectedSecurity,
      parameters: [
        {
          name: "starred",
          in: "query",
          required: false,
          description: "If true, return only starred sessions (Backlog F8).",
          schema: { type: "boolean" },
        },
      ],
      responses: {
        "200": {
          description: "Up to 20 most recent agent sessions.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  sessions: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AgentSession" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/users/me/secrets": {
    get: {
      tags: ["Users", "Secrets"],
      summary: "List labels in the caller's vault — never returns plaintext.",
      operationId: "listUserSecrets",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Label list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  labels: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "503": errorResponse("Secrets vault not configured."),
      },
    },
  },

  "/api/users/me/secrets/{label}": {
    put: {
      tags: ["Users", "Secrets"],
      summary: "Set (encrypt) a secret value for the caller.",
      operationId: "setUserSecret",
      security: protectedSecurity,
      parameters: [
        {
          name: "label",
          in: "path",
          required: true,
          description: "Secret label (1–100 chars, [A-Za-z0-9_-]).",
          schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["value"],
              properties: {
                value: { type: "string", minLength: 1, maxLength: 10_000 },
              },
            },
          },
        },
      },
      responses: {
        "204": noContentResponse("Stored."),
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
        "503": errorResponse("Secrets vault not configured."),
      },
    },
    delete: {
      tags: ["Users", "Secrets"],
      summary: "Delete a secret.",
      operationId: "deleteUserSecret",
      security: protectedSecurity,
      parameters: [
        {
          name: "label",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" },
        },
      ],
      responses: {
        "204": noContentResponse("Deleted."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Secret not found."),
        "503": errorResponse("Secrets vault not configured."),
      },
    },
  },

  "/api/users/me/budget": {
    get: {
      tags: ["Users", "Budgets"],
      summary: "Effective monthly token budget + current usage (Backlog B1).",
      operationId: "getUserBudget",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Budget status for the current month.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  scope: { type: "string", enum: ["user", "ministry", "global"] },
                  limit: { type: "integer", nullable: true },
                  used: { type: "integer" },
                  remaining: { type: "integer", nullable: true },
                  exceeded: { type: "boolean" },
                  enforced: { type: "boolean" },
                  periodStart: { type: "string", format: "date-time", nullable: true },
                  periodEnd: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  // --- Agent -----------------------------------------------------------------
  "/api/agent/sessions": {
    post: {
      tags: ["Agent"],
      summary: "Create an agent session.",
      operationId: "createAgentSession",
      security: protectedSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["prompt", "modelId"],
              properties: {
                prompt: { type: "string", minLength: 1 },
                modelId: { type: "string" },
                classification: { $ref: "#/components/schemas/Classification" },
                maxIterations: { type: "integer", minimum: 1, maximum: 200 },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Session created (idle).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AgentSession" },
            },
          },
        },
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
        "422": errorResponse("PII detected in prompt."),
      },
    },
  },

  "/api/agent/sessions/{id}/start": {
    post: {
      tags: ["Agent"],
      summary: "Start (or resume) an agent session — returns an SSE stream.",
      description:
        "Returns `text/event-stream` with iteration / tool / status events.",
      operationId: "startAgentSession",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                sectionOverrides: {
                  type: "object",
                  additionalProperties: true,
                  description: "Per-section prompt overrides.",
                },
                enabledTools: {
                  type: "array",
                  items: { type: "string" },
                  description: "Filter the available tool set.",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "SSE stream of orchestrator events.",
          content: {
            "text/event-stream": { schema: { type: "string" } },
          },
        },
        "400": errorResponse("Session not in a startable state."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Session not found."),
        "409": errorResponse("Session already running."),
        "503": errorResponse("LLM provider not configured."),
      },
    },
  },

  "/api/agent/sessions/{id}/stop": {
    post: {
      tags: ["Agent"],
      summary: "Signal a running session to stop after the current iteration.",
      operationId: "stopAgentSession",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      responses: {
        "200": {
          description: "Stop signal accepted.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  status: { type: "string", enum: ["stopping"] },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        "400": errorResponse("Session is not currently running."),
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/agent/sessions/{id}/continue": {
    post: {
      tags: ["Agent"],
      summary: "Continue a paused / completed / needs_assistance session.",
      operationId: "continueAgentSession",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["prompt"],
              properties: {
                prompt: { type: "string", minLength: 1 },
                additionalIterations: { type: "integer", minimum: 1, maximum: 100 },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "SSE stream of continuation events.",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
        "400": errorResponse("Session not in a resumable state."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Session not found."),
        "409": errorResponse("Session already running."),
        "422": errorResponse("PII detected in prompt."),
        "503": errorResponse("LLM provider not configured."),
      },
    },
  },

  "/api/agent/sessions/{id}/interject": {
    post: {
      tags: ["Agent"],
      summary: "Queue an interjection message for the next iteration.",
      operationId: "interjectAgentSession",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: { message: { type: "string", minLength: 1 } },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Interjection queued.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        "400": errorResponse("Session is not currently running."),
        "401": errorResponse("Unauthenticated."),
        "422": errorResponse("PII detected in message."),
      },
    },
  },

  "/api/agent/sessions/{id}": {
    get: {
      tags: ["Agent"],
      summary: "Full session state (memory, scratchpad, attributes).",
      operationId: "getAgentSession",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      responses: {
        "200": {
          description: "Session detail.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AgentSession" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Session not found."),
      },
    },
  },

  "/api/agent/sessions/{id}/iterations": {
    get: {
      tags: ["Agent"],
      summary: "Paginated iteration history for a session.",
      operationId: "listAgentIterations",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Agent session id."),
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200 },
        },
      ],
      responses: {
        "200": {
          description: "Iteration list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  iterations: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AgentIteration" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Session not found."),
      },
    },
  },

  "/api/agent/sessions/{id}/artifacts": {
    get: {
      tags: ["Agent"],
      summary: "List artifact metadata for a session.",
      operationId: "listAgentArtifacts",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      responses: {
        "200": {
          description: "Artifact metadata list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  artifacts: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Session not found."),
      },
    },
  },

  "/api/agent/sessions/{id}/artifacts/{artifactId}": {
    get: {
      tags: ["Agent"],
      summary: "Download a single artifact's content.",
      operationId: "getAgentArtifact",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Agent session id."),
        idPathParam("artifactId", "Artifact id."),
      ],
      responses: {
        "200": {
          description: "Artifact content (mime-type matches stored type).",
          content: {
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Artifact not found."),
      },
    },
  },

  "/api/agent/sessions/{id}/export": {
    get: {
      tags: ["Agent"],
      summary: "Download a Markdown transcript of the session.",
      operationId: "exportAgentSession",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Agent session id.")],
      responses: {
        "200": {
          description: "Markdown transcript with Content-Disposition attachment header.",
          content: { "text/markdown": { schema: { type: "string" } } },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Session not found."),
      },
    },
  },

  "/api/agent/prompt-template": {
    get: {
      tags: ["Agent"],
      summary: "Return the default system-prompt template the orchestrator uses.",
      operationId: "getPromptTemplate",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Prompt template JSON.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/agent/models": {
    get: {
      tags: ["Agent"],
      summary: "List models from the registry (filtered by classification).",
      operationId: "listAgentModels",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Available models.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  models: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  // --- Workflow --------------------------------------------------------------
  "/api/workflows/library": {
    get: {
      tags: ["Workflow"],
      summary: "Static library: agent templates, function catalog, tools manifest.",
      operationId: "getWorkflowLibrary",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Workflow library payload.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/workflows": {
    get: {
      tags: ["Workflow"],
      summary: "List workflows visible to the caller (ministry-scoped).",
      operationId: "listWorkflows",
      security: protectedSecurity,
      parameters: [
        {
          name: "templates",
          in: "query",
          required: false,
          description: "true → only templates, false → only non-templates, omit → both.",
          schema: { type: "boolean" },
        },
      ],
      responses: {
        "200": {
          description: "Workflow summary list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  workflows: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WorkflowSummary" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
      },
    },
    post: {
      tags: ["Workflow"],
      summary: "Create a workflow.",
      operationId: "createWorkflow",
      security: protectedSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "canvasData"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 200 },
                description: { type: "string", nullable: true },
                classification: { $ref: "#/components/schemas/Classification" },
                canvasData: { $ref: "#/components/schemas/CanvasData" },
                isTemplate: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Workflow created.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Workflow" },
            },
          },
        },
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
      },
    },
  },

  "/api/workflows/{id}": {
    get: {
      tags: ["Workflow"],
      summary: "Load a workflow with its canvas.",
      operationId: "getWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      responses: {
        "200": {
          description: "Workflow detail.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Workflow" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Outside the caller's ministry."),
        "404": errorResponse("Workflow not found."),
      },
    },
    put: {
      tags: ["Workflow"],
      summary: "Update a workflow (partial — bumps version only on canvas change).",
      operationId: "updateWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", maxLength: 200 },
                description: { type: "string", nullable: true },
                classification: { $ref: "#/components/schemas/Classification" },
                canvasData: { $ref: "#/components/schemas/CanvasData" },
                isTemplate: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated workflow.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Workflow" },
            },
          },
        },
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Outside the caller's ministry."),
        "404": errorResponse("Workflow not found."),
      },
    },
    delete: {
      tags: ["Workflow"],
      summary: "Soft-delete a workflow (Backlog B4).",
      description:
        "Sets `deleted_at = NOW()`. The row remains for `WORKFLOW_TRASH_RETENTION_DAYS` days; admins can restore from the Trash panel.",
      operationId: "deleteWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      responses: {
        "200": {
          description: "Soft-deleted.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  deleted: { type: "boolean" },
                  soft: { type: "boolean" },
                  deletedAt: { type: "string", format: "date-time", nullable: true },
                  recoverableUntil: { type: "string", format: "date-time", nullable: true },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Caller is not the owner and not an admin."),
        "404": errorResponse("Workflow not found."),
      },
    },
  },

  "/api/workflows/{id}/duplicate": {
    post: {
      tags: ["Workflow"],
      summary: "Duplicate a workflow as a new private (non-template) copy.",
      operationId: "duplicateWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Source workflow id.")],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", maxLength: 200 },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "New copy.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Workflow" },
            },
          },
        },
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Source workflow not found."),
      },
    },
  },

  "/api/workflows/{id}/execute": {
    post: {
      tags: ["Workflow"],
      summary: "Execute a workflow — returns an SSE stream of stage events.",
      operationId: "executeWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                continueOnError: { type: "boolean" },
                dryRun: {
                  type: "boolean",
                  description:
                    "Backlog B7: walk the graph with stubbed LLM/tool/function calls. Zero tokens.",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "SSE stream of workflow events.",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Outside the caller's ministry."),
        "404": errorResponse("Workflow not found."),
        "503": errorResponse("LLM provider not configured (real run only)."),
      },
    },
  },

  "/api/workflows/{id}/estimate": {
    post: {
      tags: ["Workflow"],
      summary: "Estimate token + dollar cost before running.",
      operationId: "estimateWorkflowCost",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                canvasData: { $ref: "#/components/schemas/CanvasData" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Cost estimate.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WorkflowCostEstimate" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Workflow not found."),
      },
    },
  },

  "/api/workflows/{id}/versions": {
    get: {
      tags: ["Workflow"],
      summary: "List a workflow's version snapshots.",
      operationId: "listWorkflowVersions",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      responses: {
        "200": {
          description: "Version list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  currentVersion: { type: "integer" },
                  versions: {
                    type: "array",
                    items: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Workflow not found."),
      },
    },
  },

  "/api/workflows/{id}/versions/{version}": {
    get: {
      tags: ["Workflow"],
      summary: "Load a specific historical version's canvas.",
      operationId: "getWorkflowVersion",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        idPathParam("version", "Version number.", "int"),
      ],
      responses: {
        "200": {
          description: "Version detail.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Version not found."),
      },
    },
  },

  "/api/workflows/{id}/versions/{version}/restore": {
    post: {
      tags: ["Workflow"],
      summary: "Restore a historical version as the current canvas.",
      operationId: "restoreWorkflowVersion",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        idPathParam("version", "Version number to restore.", "int"),
      ],
      responses: {
        "200": {
          description: "Restored workflow detail.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Workflow" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Workflow or version not found."),
      },
    },
  },

  "/api/workflows/{id}/executions": {
    get: {
      tags: ["Workflow"],
      summary: "List executions for a workflow.",
      operationId: "listWorkflowExecutions",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200 },
        },
      ],
      responses: {
        "200": {
          description: "Execution summary list.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Workflow not found."),
      },
    },
  },

  "/api/workflows/{id}/executions/{executionId}": {
    get: {
      tags: ["Workflow"],
      summary: "Detail for a single execution.",
      operationId: "getWorkflowExecution",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        idPathParam("executionId", "Execution id."),
      ],
      responses: {
        "200": {
          description: "Execution detail.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Execution not found."),
      },
    },
  },

  "/api/workflows/{id}/executions/{executionId}/stop": {
    post: {
      tags: ["Workflow"],
      summary: "Stop an in-flight workflow execution.",
      operationId: "stopWorkflowExecution",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        idPathParam("executionId", "Execution id."),
      ],
      responses: {
        "200": {
          description: "Stop signal accepted.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "400": errorResponse("Execution is not currently running."),
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Execution not found."),
      },
    },
  },

  "/api/workflows/{id}/executions/{executionId}/artifacts": {
    get: {
      tags: ["Workflow"],
      summary: "Artifacts produced during a workflow execution.",
      operationId: "listWorkflowExecutionArtifacts",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        idPathParam("executionId", "Execution id."),
      ],
      responses: {
        "200": {
          description: "Artifact metadata list.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Execution not found."),
      },
    },
  },

  "/api/workflows/{id}/executions/{executionId}/artifacts/{artifactId}": {
    get: {
      tags: ["Workflow"],
      summary: "Download a workflow-execution artifact's content.",
      operationId: "getWorkflowExecutionArtifact",
      security: protectedSecurity,
      parameters: [
        idPathParam("id", "Workflow id."),
        idPathParam("executionId", "Execution id."),
        idPathParam("artifactId", "Artifact id."),
      ],
      responses: {
        "200": {
          description: "Artifact content.",
          content: {
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "404": errorResponse("Artifact not found."),
      },
    },
  },

  // --- Admin -----------------------------------------------------------------
  "/api/admin/audit": {
    get: {
      tags: ["Admin"],
      summary: "Query the audit log.",
      operationId: "listAuditEvents",
      security: protectedSecurity,
      parameters: [
        { name: "action", in: "query", required: false, schema: { type: "string" } },
        { name: "userId", in: "query", required: false, schema: { type: "string", format: "uuid" } },
        { name: "ministryCode", in: "query", required: false, schema: { type: "string" } },
        { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
        { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } },
      ],
      responses: {
        "200": {
          description: "Matching audit events.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  events: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AuditEvent" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/audit/export.csv": {
    get: {
      tags: ["Admin"],
      summary: "Export audit events as CSV.",
      operationId: "exportAuditCsv",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "CSV download.",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/pii-detections": {
    get: {
      tags: ["Admin"],
      summary: "Forensic view of recent PII detections.",
      operationId: "listPiiDetections",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Detection list.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/models": {
    get: {
      tags: ["Admin"],
      summary: "Full model registry (admin-only).",
      operationId: "listAdminModels",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Model registry rows.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/models/{id}": {
    put: {
      tags: ["Admin"],
      summary: "Toggle a model row (enabled / classification / cost / etc.).",
      operationId: "updateAdminModel",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Model id.", "string")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated row.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
        "404": errorResponse("Model not found."),
      },
    },
  },

  "/api/admin/sessions": {
    get: {
      tags: ["Admin"],
      summary: "All agent sessions (admin-only).",
      operationId: "listAdminSessions",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Session list.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  sessions: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AgentSession" },
                  },
                },
              },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/workflow-executions": {
    get: {
      tags: ["Admin"],
      summary: "All workflow executions (admin-only).",
      operationId: "listAdminWorkflowExecutions",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Execution list.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/retention/run": {
    post: {
      tags: ["Admin"],
      summary: "Manually trigger a retention pass (admin-only).",
      operationId: "runRetentionPass",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Retention report.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/workflows/trash": {
    get: {
      tags: ["Admin"],
      summary: "Soft-deleted workflows still in the restore window.",
      operationId: "listTrashedWorkflows",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Trashed workflows + each row's `expiresAt`.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/workflows/{id}/restore": {
    post: {
      tags: ["Admin"],
      summary: "Restore a soft-deleted workflow.",
      operationId: "restoreTrashedWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      responses: {
        "200": {
          description: "Restored workflow.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Workflow" } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
        "404": errorResponse("Workflow not found in trash."),
      },
    },
  },

  "/api/admin/workflows/{id}/purge": {
    post: {
      tags: ["Admin"],
      summary: "Permanently delete a soft-deleted workflow.",
      operationId: "purgeTrashedWorkflow",
      security: protectedSecurity,
      parameters: [idPathParam("id", "Workflow id.")],
      responses: {
        "200": {
          description: "Purged.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
        "404": errorResponse("Workflow not found in trash."),
      },
    },
  },

  "/api/admin/dashboard": {
    get: {
      tags: ["Admin"],
      summary: "Aggregated dashboard metrics (sessions, tokens, errors).",
      operationId: "adminDashboard",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Dashboard payload.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/users/{id}/export": {
    post: {
      tags: ["Admin", "Compliance"],
      summary: "FOIP s.7 right-of-access user data export (Backlog B6).",
      description:
        "Returns `application/zip` containing one JSON per user-attributable table plus a README.md.",
      operationId: "exportUserData",
      security: protectedSecurity,
      parameters: [idPathParam("id", "User id to export.")],
      responses: {
        "200": {
          description: "ZIP archive with one JSON file per table.",
          content: {
            "application/zip": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
        "404": errorResponse("User not found."),
      },
    },
  },

  "/api/admin/budgets": {
    get: {
      tags: ["Admin", "Budgets"],
      summary: "List token budgets (Backlog B1).",
      operationId: "listTokenBudgets",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Budgets sorted by scope.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
    put: {
      tags: ["Admin", "Budgets"],
      summary: "Upsert a token budget.",
      operationId: "upsertTokenBudget",
      security: protectedSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["scopeType", "scopeId", "monthlyTokenLimit"],
              properties: {
                scopeType: { type: "string", enum: ["user", "ministry", "global"] },
                scopeId: { type: "string" },
                monthlyTokenLimit: { type: "integer", minimum: 0 },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Upserted budget row.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "400": errorResponse("Validation error."),
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  "/api/admin/budgets/{scopeType}/{scopeId}": {
    delete: {
      tags: ["Admin", "Budgets"],
      summary: "Delete a token budget (cannot delete the global default).",
      operationId: "deleteTokenBudget",
      security: protectedSecurity,
      parameters: [
        {
          name: "scopeType",
          in: "path",
          required: true,
          schema: { type: "string", enum: ["user", "ministry", "global"] },
        },
        {
          name: "scopeId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "204": noContentResponse("Deleted."),
        "400": errorResponse("Cannot delete the global default."),
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
        "404": errorResponse("Budget not found."),
      },
    },
  },

  "/api/admin/budgets/usage": {
    get: {
      tags: ["Admin", "Budgets"],
      summary: "Per-scope `{ used, limit, remaining }` for the current month.",
      operationId: "tokenBudgetUsage",
      security: protectedSecurity,
      responses: {
        "200": {
          description: "Usage rows.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
        "401": errorResponse("Unauthenticated."),
        "403": errorResponse("Non-admin caller."),
      },
    },
  },

  // --- OpenAPI itself --------------------------------------------------------
  "/api/openapi.json": {
    get: {
      tags: ["Meta"],
      summary: "This OpenAPI document.",
      operationId: "getOpenApiSpec",
      security: publicSecurity,
      responses: {
        "200": {
          description: "OpenAPI 3.1 document.",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: true } },
          },
        },
      },
    },
  },

  "/api/docs": {
    get: {
      tags: ["Meta"],
      summary: "Swagger UI for interactive API exploration.",
      operationId: "getApiDocs",
      security: publicSecurity,
      responses: {
        "200": {
          description: "HTML page rendering Swagger UI against `/api/openapi.json`.",
          content: { "text/html": { schema: { type: "string" } } },
        },
      },
    },
  },
};

// ============================================================================
// PUBLIC ENTRY POINT
// ============================================================================

const tags = [
  { name: "Auth", description: "Sign-in, sign-out, and current-user endpoints." },
  { name: "Users", description: "Per-user preferences, saved prompts, vault, history." },
  { name: "Agent", description: "Free Agent sessions, iterations, and artifacts." },
  { name: "Workflow", description: "Workflow canvas CRUD, execution, versions." },
  { name: "Admin", description: "Administrative endpoints (admin role required)." },
  { name: "Budgets", description: "Per-user / per-ministry token budgets (Backlog B1)." },
  { name: "Compliance", description: "Audit and FOIP right-of-access endpoints." },
  { name: "Secrets", description: "Per-user encrypted credential storage." },
  { name: "Health", description: "Liveness, readiness, and diagnostic probes." },
  { name: "Observability", description: "Prometheus metrics." },
  { name: "Meta", description: "Self-documenting endpoints (OpenAPI + Swagger UI)." },
];

export interface BuildOpenApiSpecOptions {
  /**
   * Application semver. Defaults to the value in the backend `package.json`
   * via the caller — we accept it as a parameter rather than reading the file
   * here so the function stays synchronous and test-friendly.
   */
  version: string;
  /**
   * Public base URL for the `servers` array. Defaults to `env.FRONTEND_URL`
   * so the deployed spec advertises the production host. Falls back to
   * `http://localhost:{PORT}` in dev.
   */
  publicUrl?: string;
}

export function buildOpenApiSpec(options: BuildOpenApiSpecOptions): OpenAPIObject {
  const publicUrl =
    options.publicUrl ?? env.FRONTEND_URL ?? `http://localhost:${env.PORT}`;

  return {
    openapi: "3.1.0",
    info: {
      title: "ABC Agent Builder Console API",
      version: options.version,
      description:
        "REST + SSE API for the Government of Alberta ABC Agent Builder Console. " +
        "Authentication is cookie-based (session cookie issued by Entra ID OIDC flow). " +
        "All endpoints under `/api/admin` require the `admin` role. " +
        "Most endpoints are ministry-scoped.",
      contact: { name: "ABC Team", email: "cohen.mcleod@gov.ab.ca" },
      license: { name: "Government of Alberta — Internal" },
    },
    servers: [
      { url: publicUrl, description: "Configured deployment" },
      { url: "/", description: "Same-origin (browser callers)" },
    ],
    tags,
    paths,
    components: {
      schemas,
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "abc_session",
          description:
            "Signed session cookie issued by `/api/auth/callback` after a successful Entra ID OIDC flow.",
        },
      },
    },
  };
}

/**
 * Test-only: snapshot the path list. Lets the unit test compare against the
 * actual `routes/*.ts` files in the suite so adding a route without spec
 * coverage is a red test.
 */
export function listSpecPaths(): string[] {
  return Object.keys(paths).sort();
}
