#!/usr/bin/env tsx
/**
 * ABC scenario runner.
 *
 * Drives a live backend through one scenario file: creates a session, opens
 * the SSE stream, accumulates events, then evaluates the scenario's
 * `expect` block against what we observed.
 *
 * Exit codes:
 *   0  every expectation matched
 *   1  one or more expectations failed
 *   2  scenario file invalid / runner crashed
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 npx tsx runners/scenarioRunner.ts \
 *     scenarios/03_pii_blocking.json
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

interface ScenarioRequest {
  prompt: string;
  modelId?: string;
  classification?: string;
  maxIterations?: number;
}

interface ScenarioExpect {
  creationStatus?: number;
  events?: {
    mustContain?: string[];
    mustNotContain?: string[];
  };
  finalStatus?: string;
  piiDetected?: boolean;
}

interface Scenario {
  name: string;
  description: string;
  request: ScenarioRequest;
  llmMock?: string;
  expect: ScenarioExpect;
}

interface SSEEvent {
  type: string;
  [k: string]: unknown;
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_HEADER = process.env.ABC_BEARER
  ? { Authorization: `Bearer ${process.env.ABC_BEARER}` }
  : {};

function fail(msg: string, exitCode: 1 | 2 = 1): never {
  console.error(`FAIL: ${msg}`);
  process.exit(exitCode);
}

function readScenario(path: string): Scenario {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(resolvePath(path), "utf8"));
  } catch (err) {
    fail(`could not read scenario at ${path}: ${(err as Error).message}`, 2);
  }
  const s = json as Scenario;
  if (!s.name || !s.request || !s.expect) {
    fail("scenario must have { name, request, expect }", 2);
  }
  return s;
}

async function createSession(req: ScenarioRequest): Promise<{ status: number; sessionId?: string }> {
  const res = await fetch(`${BASE_URL}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADER },
    body: JSON.stringify({
      prompt: req.prompt,
      modelId: req.modelId ?? "claude-haiku-4-5",
      classification: req.classification ?? "unclassified",
      maxIterations: req.maxIterations ?? 5,
    }),
  });
  if (!res.ok) return { status: res.status };
  const body = (await res.json()) as { id?: string; sessionId?: string };
  return { status: res.status, sessionId: body.id ?? body.sessionId };
}

async function streamSession(sessionId: string): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const res = await fetch(`${BASE_URL}/api/agent/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...AUTH_HEADER },
    body: JSON.stringify({}),
  });
  if (!res.body) return events;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; each line in a frame starts with `data: `.
    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));
      if (dataLines.length === 0) continue;
      try {
        events.push(JSON.parse(dataLines.join("\n")) as SSEEvent);
      } catch {
        // Heartbeats / non-JSON frames — ignore
      }
    }
  }
  return events;
}

function evaluate(scenario: Scenario, observed: { creationStatus: number; events: SSEEvent[] }): string[] {
  const failures: string[] = [];
  const e = scenario.expect;

  if (e.creationStatus !== undefined && e.creationStatus !== observed.creationStatus) {
    failures.push(
      `creationStatus: expected ${e.creationStatus}, got ${observed.creationStatus}`,
    );
  }

  const eventTypes = new Set(observed.events.map((ev) => ev.type));

  for (const must of e.events?.mustContain ?? []) {
    if (!eventTypes.has(must)) failures.push(`events.mustContain: missing "${must}"`);
  }
  for (const mustNot of e.events?.mustNotContain ?? []) {
    if (eventTypes.has(mustNot)) failures.push(`events.mustNotContain: saw forbidden "${mustNot}"`);
  }

  if (e.finalStatus !== undefined) {
    const terminal = observed.events.findLast?.((ev) =>
      ["session_complete", "session_stopped", "iteration_limit", "error"].includes(ev.type),
    );
    const actual =
      terminal?.type === "session_complete"
        ? "completed"
        : terminal?.type === "session_stopped"
          ? "stopped"
          : terminal?.type === "iteration_limit"
            ? "iteration_limit"
            : terminal?.type === "error"
              ? "error"
              : "unknown";
    if (actual !== e.finalStatus) {
      failures.push(`finalStatus: expected "${e.finalStatus}", got "${actual}"`);
    }
  }

  if (e.piiDetected !== undefined) {
    const sawPII = eventTypes.has("pii_warning");
    if (sawPII !== e.piiDetected) {
      failures.push(`piiDetected: expected ${e.piiDetected}, got ${sawPII}`);
    }
  }

  return failures;
}

async function main(): Promise<void> {
  const scenarioPath = process.argv[2];
  if (!scenarioPath) fail("usage: scenarioRunner.ts <scenario.json>", 2);

  const scenario = readScenario(scenarioPath);
  console.log(`> ${scenario.name}`);
  console.log(`  ${scenario.description}`);
  console.log(`  base url: ${BASE_URL}`);

  const created = await createSession(scenario.request);
  const observed: { creationStatus: number; events: SSEEvent[] } = {
    creationStatus: created.status,
    events: [],
  };

  if (created.sessionId) {
    try {
      observed.events = await streamSession(created.sessionId);
    } catch (err) {
      console.error(`  stream error: ${(err as Error).message}`);
    }
  }

  console.log(`  observed: status=${observed.creationStatus} events=${observed.events.length}`);

  const failures = evaluate(scenario, observed);
  if (failures.length > 0) {
    console.error("");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ all expectations matched");
}

main().catch((err) => fail(`runner crashed: ${(err as Error).stack ?? err}`, 2));
