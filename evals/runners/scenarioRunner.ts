/**
 * Scenario runner — drives the live backend through a deterministic
 * end-to-end test against the MockProvider.
 *
 * What it does:
 * 1. Spawns the backend (npx tsx src/index.ts) on an ephemeral port with
 *    MOCK_LLM=1 and a per-run DB schema.
 * 2. Waits for /api/health to return healthy.
 * 3. Registers the scenario's canned LLM responses via a test-only endpoint.
 * 4. Creates a session, starts it, consumes SSE.
 * 5. Validates the observed event subsequence + final session state against
 *    the scenario's expectations.
 * 6. Tears down the backend and drops the per-run schema.
 *
 * Scenarios are JSON files validated via Zod (see SCENARIO_SCHEMA below).
 */

import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const BACKEND_DIR = resolve(REPO_ROOT, "backend");
const SCENARIOS_DIR = resolve(__dirname, "../scenarios");

// ============================================================================
// SCENARIO SCHEMA
// ============================================================================

const llmResponseSchema = z.object({
  thinking: z.string().optional(),
  toolCalls: z.array(z.object({ name: z.string(), arguments: z.record(z.unknown()) })).optional(),
  blackboardUpdates: z.array(z.object({ category: z.string(), title: z.string(), content: z.string() })).optional(),
  scratchpad: z.string().nullable().optional(),
  attributeUpdates: z.record(z.unknown()).nullable().optional(),
  status: z.enum(["running", "completed", "needs_assistance", "error"]).optional(),
  userMessage: z.string().optional(),
  error: z.string().optional(),
  usage: z.object({ promptTokens: z.number(), completionTokens: z.number() }).optional(),
});

const expectationSchema = z.object({
  /** HTTP status of the POST /sessions response. Default 201. */
  createStatus: z.number().optional(),
  /** HTTP status of the POST /sessions/:id/start response. Default 200. */
  startStatus: z.number().optional(),
  /** SSE event types that must appear, in this order, as a subsequence. */
  sseSubsequence: z.array(z.string()).optional(),
  /** Event types that must NOT appear at all. */
  sseAbsent: z.array(z.string()).optional(),
  /** Expected blackboard categories present after run. */
  blackboardCategories: z.array(z.string()).optional(),
  /** Expected terminal session status. */
  finalStatus: z.enum(["idle", "running", "paused", "completed", "error", "needs_assistance"]).optional(),
  /** Final blackboard entry count, exact or {min, max}. */
  blackboardCount: z.union([z.number(), z.object({ min: z.number().optional(), max: z.number().optional() })]).optional(),
  /** Expected error message regex (matches against session.error or 4xx body). */
  errorMatches: z.string().optional(),
  /** When set, the scenario expects creation to fail and not even reach start. */
  expectCreateRejection: z.boolean().optional(),
  /** Regex string that must match the persisted scratchpad after the run. */
  scratchpadMatches: z.string().optional(),
  /** Subset of attributes that must be present (key/value equality) in the persisted attributes. */
  attributesContain: z.record(z.unknown()).optional(),
  /**
   * Substring (case-insensitive) that must appear in the iteration_limit SSE
   * event's `message` field, when present. Useful for pinning iteration-cap
   * scenarios without requiring an exact message match.
   */
  iterationLimitMessageContains: z.string().optional(),
});

const scenarioSchema = z.object({
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  modelId: z.string().default("mock-llm"),
  classification: z.enum(["unclassified", "protected_a", "protected_b"]).default("unclassified"),
  /**
   * Optional cap forwarded to POST /sessions. Defaults to the backend's
   * built-in 50 when omitted. Cap-tests should set this low so the loop
   * terminates within the harness's wall-clock budget.
   */
  maxIterations: z.number().int().positive().max(100).optional(),
  llmResponses: z.array(llmResponseSchema).default([]),
  expectations: expectationSchema,
});

export type Scenario = z.infer<typeof scenarioSchema>;

// ============================================================================
// BACKEND LIFECYCLE
// ============================================================================

async function findFreePort(): Promise<number> {
  return new Promise((resolveFn) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolveFn(port));
    });
  });
}

interface BackendHandle {
  child: ChildProcess;
  port: number;
  schema: string;
}

async function spawnBackend(): Promise<BackendHandle> {
  const port = await findFreePort();
  const schema = `evals_run_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      MOCK_LLM: "1",
      DB_SCHEMA: schema,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "mock-key",
      EVALS_TEST_MODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (data) => {
    if (process.env.EVALS_VERBOSE) process.stdout.write(`[backend] ${data}`);
  });
  child.stderr?.on("data", (data) => {
    if (process.env.EVALS_VERBOSE) process.stderr.write(`[backend] ${data}`);
  });

  // Wait for /api/health to return 200
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200 || res.status === 503) {
        return { child, port, schema };
      }
    } catch {
      // Not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`Backend did not become healthy within 60s on port ${port}`);
}

async function tearDownBackend(handle: BackendHandle): Promise<void> {
  if (!handle.child.killed) {
    handle.child.kill("SIGTERM");
    // Wait a bit for graceful shutdown
    await new Promise((r) => setTimeout(r, 500));
    if (!handle.child.killed) {
      handle.child.kill("SIGKILL");
    }
  }
}

// ============================================================================
// SSE PARSER
// ============================================================================

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

function parseSse(chunk: string): SSEEvent[] {
  const out: SSEEvent[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data: ")) continue;
    try {
      out.push(JSON.parse(trimmed.slice(6).trim()) as SSEEvent);
    } catch {
      // skip
    }
  }
  return out;
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

async function postJson(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let body_: unknown;
  try {
    body_ = await res.json();
  } catch {
    body_ = await res.text();
  }
  return { status: res.status, body: body_ };
}

async function getJson(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`);
  let body_: unknown;
  try {
    body_ = await res.json();
  } catch {
    body_ = await res.text();
  }
  return { status: res.status, body: body_ };
}

async function streamSse(
  base: string,
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; events: SSEEvent[] }> {
  const events: SSEEvent[] = [];
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.body) return { status: res.status, events };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    events.push(...parseSse(lines.join("\n")));
  }
  if (buffer.trim()) events.push(...parseSse(buffer));
  return { status: res.status, events };
}

// ============================================================================
// ASSERTIONS
// ============================================================================

function hasSubsequence(events: SSEEvent[], expected: string[]): boolean {
  let cursor = 0;
  for (const e of events) {
    if (e.type === expected[cursor]) cursor++;
    if (cursor === expected.length) return true;
  }
  return false;
}

function assertExpectations(
  scenario: Scenario,
  results: {
    createStatus: number;
    createBody: unknown;
    startStatus?: number;
    events?: SSEEvent[];
    finalSession?: {
      status: string;
      blackboard: Array<{ category: string }>;
      scratchpad?: string;
      attributes?: Record<string, unknown>;
    };
  }
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const exp = scenario.expectations;

  if (exp.expectCreateRejection) {
    if (results.createStatus < 400) {
      failures.push(`expected create rejection but got status ${results.createStatus}`);
    }
    if (exp.errorMatches) {
      const body = JSON.stringify(results.createBody);
      if (!new RegExp(exp.errorMatches, "i").test(body)) {
        failures.push(`expected error matching /${exp.errorMatches}/, got ${body}`);
      }
    }
    return { passed: failures.length === 0, failures };
  }

  if (exp.createStatus !== undefined && results.createStatus !== exp.createStatus) {
    failures.push(`expected create status ${exp.createStatus}, got ${results.createStatus}`);
  }

  if (exp.startStatus !== undefined && results.startStatus !== exp.startStatus) {
    failures.push(`expected start status ${exp.startStatus}, got ${results.startStatus}`);
  }

  if (exp.sseSubsequence && results.events) {
    if (!hasSubsequence(results.events, exp.sseSubsequence)) {
      const observed = results.events.map((e) => e.type).join(" → ");
      failures.push(`expected SSE subsequence ${exp.sseSubsequence.join(" → ")} not found in ${observed}`);
    }
  }

  if (exp.sseAbsent && results.events) {
    for (const type of exp.sseAbsent) {
      if (results.events.some((e) => e.type === type)) {
        failures.push(`SSE event "${type}" was present but expected absent`);
      }
    }
  }

  if (exp.finalStatus && results.finalSession) {
    if (results.finalSession.status !== exp.finalStatus) {
      failures.push(`expected final status "${exp.finalStatus}", got "${results.finalSession.status}"`);
    }
  }

  if (exp.blackboardCategories && results.finalSession) {
    const have = new Set(results.finalSession.blackboard.map((b) => b.category));
    for (const cat of exp.blackboardCategories) {
      if (!have.has(cat)) {
        failures.push(`expected blackboard to contain category "${cat}"`);
      }
    }
  }

  if (exp.blackboardCount !== undefined && results.finalSession) {
    const count = results.finalSession.blackboard.length;
    if (typeof exp.blackboardCount === "number") {
      if (count !== exp.blackboardCount) {
        failures.push(`expected blackboard count ${exp.blackboardCount}, got ${count}`);
      }
    } else {
      if (exp.blackboardCount.min !== undefined && count < exp.blackboardCount.min) {
        failures.push(`expected blackboard count >= ${exp.blackboardCount.min}, got ${count}`);
      }
      if (exp.blackboardCount.max !== undefined && count > exp.blackboardCount.max) {
        failures.push(`expected blackboard count <= ${exp.blackboardCount.max}, got ${count}`);
      }
    }
  }

  if (exp.scratchpadMatches && results.finalSession) {
    const scratchpad = results.finalSession.scratchpad ?? "";
    if (!new RegExp(exp.scratchpadMatches, "i").test(scratchpad)) {
      const preview = scratchpad.length > 200 ? `${scratchpad.slice(0, 200)}…` : scratchpad;
      failures.push(`expected scratchpad to match /${exp.scratchpadMatches}/i, got "${preview}"`);
    }
  }

  if (exp.attributesContain && results.finalSession) {
    const attrs = results.finalSession.attributes ?? {};
    for (const [key, expected] of Object.entries(exp.attributesContain)) {
      if (!(key in attrs)) {
        failures.push(`expected attribute "${key}" to be present`);
        continue;
      }
      if (JSON.stringify(attrs[key]) !== JSON.stringify(expected)) {
        failures.push(
          `expected attribute "${key}" to equal ${JSON.stringify(expected)}, got ${JSON.stringify(attrs[key])}`,
        );
      }
    }
  }

  if (exp.iterationLimitMessageContains && results.events) {
    const limit = results.events.find((e) => e.type === "iteration_limit");
    if (!limit) {
      failures.push(`expected an iteration_limit SSE event but none was emitted`);
    } else {
      const message = typeof limit.message === "string" ? limit.message : "";
      if (!message.toLowerCase().includes(exp.iterationLimitMessageContains.toLowerCase())) {
        failures.push(
          `expected iteration_limit message to contain "${exp.iterationLimitMessageContains}", got "${message}"`,
        );
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

// ============================================================================
// RUNNER
// ============================================================================

export interface RunResult {
  name: string;
  passed: boolean;
  failures: string[];
  events: SSEEvent[];
  durationMs: number;
}

export function loadScenario(path: string): Scenario {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return scenarioSchema.parse(raw);
}

export function listScenarios(): string[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => resolve(SCENARIOS_DIR, f))
    .sort();
}

export async function runScenario(scenario: Scenario, backend: BackendHandle): Promise<RunResult> {
  const start = Date.now();
  const base = `http://127.0.0.1:${backend.port}`;

  // Step 1: create session
  const createBody: Record<string, unknown> = {
    prompt: scenario.prompt,
    modelId: scenario.modelId,
    classification: scenario.classification,
  };
  if (scenario.maxIterations !== undefined) {
    createBody.maxIterations = scenario.maxIterations;
  }
  const create = await postJson(base, "/api/agent/sessions", createBody);

  if (scenario.expectations.expectCreateRejection) {
    const result = assertExpectations(scenario, {
      createStatus: create.status,
      createBody: create.body,
    });
    return {
      name: scenario.name,
      passed: result.passed,
      failures: result.failures,
      events: [],
      durationMs: Date.now() - start,
    };
  }

  if (create.status !== 201) {
    return {
      name: scenario.name,
      passed: false,
      failures: [`session creation failed with status ${create.status}: ${JSON.stringify(create.body)}`],
      events: [],
      durationMs: Date.now() - start,
    };
  }

  const sessionId = (create.body as { id: string }).id;

  // Step 2: register canned responses (test-only endpoint, gated by MOCK_LLM=1)
  if (scenario.llmResponses.length > 0) {
    await postJson(base, "/api/test/mock-llm", {
      sessionId,
      responses: scenario.llmResponses,
    });
  }

  // Step 3: start session and collect SSE
  const stream = await streamSse(base, `/api/agent/sessions/${sessionId}/start`, {});

  // Step 4: fetch final session state
  const final = await getJson(base, `/api/agent/sessions/${sessionId}`);
  const finalSession = final.body as {
    status: string;
    blackboard: Array<{ category: string }>;
    scratchpad?: string;
    attributes?: Record<string, unknown>;
  };

  // Step 5: assertions
  const result = assertExpectations(scenario, {
    createStatus: create.status,
    createBody: create.body,
    startStatus: stream.status,
    events: stream.events,
    finalSession,
  });

  return {
    name: scenario.name,
    passed: result.passed,
    failures: result.failures,
    events: stream.events,
    durationMs: Date.now() - start,
  };
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let scenarioPath: string;
  if (args.length === 0) {
    console.error("Usage: tsx scenarioRunner.ts <scenario.json>");
    process.exit(2);
  } else {
    scenarioPath = resolve(args[0]);
  }

  const scenario = loadScenario(scenarioPath);
  const backend = await spawnBackend();
  try {
    const result = await runScenario(scenario, backend);
    if (result.passed) {
      console.log(`✓ ${result.name} (${result.durationMs}ms)`);
      process.exit(0);
    } else {
      console.log(`✗ ${result.name} (${result.durationMs}ms)`);
      for (const f of result.failures) console.log(`  - ${f}`);
      process.exit(1);
    }
  } finally {
    await tearDownBackend(backend);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

export { spawnBackend, tearDownBackend, BackendHandle };
