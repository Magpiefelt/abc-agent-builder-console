/**
 * Unit tests for sessionExporter.
 *
 * The exporter is a pure formatter — no DB, no network. Tests pass in
 * synthetic session / iteration / artifact data and assert on the resulting
 * Markdown.
 */

import { describe, it, expect } from "vitest";
import {
  buildSessionTranscript,
  buildExportFilename,
  type ExporterIteration,
  type ExporterArtifact,
} from "../sessionExporter.js";
import type { AgentSession } from "../agentOrchestrator.js";

function baseSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    userId: "user-1",
    ministryCode: "TBF",
    prompt: "Summarize the Alberta budget speech.",
    modelId: "claude-sonnet-4-6",
    maxIterations: 50,
    currentIteration: 3,
    status: "completed",
    classification: "protected_a",
    blackboard: [],
    scratchpad: "",
    attributes: {},
    finalReport: null,
    error: null,
    createdAt: "2026-05-22T10:00:00.000Z",
    ...overrides,
  };
}

function iter(overrides: Partial<ExporterIteration> = {}): ExporterIteration {
  return {
    iterationNumber: 1,
    status: "complete",
    userPrompt: null,
    rawResponse: null,
    parsedResponse: null,
    toolCalls: [],
    toolResults: [],
    blackboardEntry: null,
    error: null,
    tokensUsed: null,
    durationMs: null,
    createdAt: "2026-05-22T10:00:01.000Z",
    ...overrides,
  };
}

describe("buildSessionTranscript", () => {
  it("renders the canonical header block with session metadata", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("# ABC Free Agent — Session Transcript");
    expect(md).toContain("| Session ID | `11111111-2222-3333-4444-555555555555` |");
    expect(md).toContain("| Model | claude-sonnet-4-6 |");
    expect(md).toContain("| Classification | Protected A |");
    expect(md).toContain("| Status | Completed |");
    expect(md).toContain("| Iterations completed | 3 of 50 |");
    expect(md).toContain("| Ministry | TBF |");
  });

  it("omits ministry row when ministryCode is null", () => {
    const md = buildSessionTranscript({
      session: baseSession({ ministryCode: null }),
      iterations: [],
      artifacts: [],
    });
    expect(md).not.toContain("| Ministry |");
  });

  it("renders the original prompt inside a fenced block", () => {
    const md = buildSessionTranscript({
      session: baseSession({ prompt: "do the thing" }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Original prompt");
    expect(md).toMatch(/```text\ndo the thing\n```/);
  });

  it("expands the fence length when the prompt already contains triple backticks", () => {
    const sneaky = "look at ```\nthis\n```";
    const md = buildSessionTranscript({
      session: baseSession({ prompt: sneaky }),
      iterations: [],
      artifacts: [],
    });
    // The exporter must pick a fence longer than the embedded triple-backtick
    // so the inner content remains intact.
    expect(md).toMatch(/````text\nlook at ```\nthis\n```\n````/);
  });

  it("renders an empty-iterations placeholder when no iterations are provided", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Iterations");
    expect(md).toContain("_No iterations recorded._");
  });

  it("renders each iteration with status, parsed thinking, message, tool calls, and results", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [
        iter({
          iterationNumber: 1,
          status: "complete",
          parsedResponse: {
            thinking: "Need to fetch the speech.",
            userMessage: "Fetching speech…",
            status: "in_progress",
          },
          toolCalls: [{ tool: "web_search", params: { q: "alberta budget 2026" } }],
          toolResults: [
            { tool: "web_search", success: true, durationMs: 320 },
            { tool: "web_search", success: false, durationMs: 80, error: "timeout" },
          ],
          tokensUsed: 1234,
          durationMs: 4200,
        }),
      ],
      artifacts: [],
    });

    expect(md).toContain("### Iteration 1");
    expect(md).toContain("status: `complete`");
    expect(md).toContain("parsed: `in_progress`");
    expect(md).toContain("duration: 4200 ms");
    expect(md).toContain("tokens: 1234");
    expect(md).toContain("**Thinking:**");
    expect(md).toContain("> Need to fetch the speech.");
    expect(md).toContain("**Assistant message:**");
    expect(md).toContain("> Fetching speech…");
    expect(md).toContain("**Tool calls (1):**");
    expect(md).toContain("- `web_search`");
    expect(md).toContain('"q": "alberta budget 2026"');
    expect(md).toContain("**Tool results (2):**");
    expect(md).toContain("| `web_search` | ✅ | 320 ms | — |");
    expect(md).toContain("| `web_search` | ❌ | 80 ms | timeout |");
  });

  it("handles iteration tool_calls supplied as a JSON string", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [
        iter({
          toolCalls: JSON.stringify([{ tool: "github_repo_search", params: { q: "abc" } }]),
        }),
      ],
      artifacts: [],
    });
    expect(md).toContain("**Tool calls (1):**");
    expect(md).toContain("- `github_repo_search`");
  });

  it("truncates very long user prompts inside iterations", () => {
    const huge = "x".repeat(5000);
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [iter({ userPrompt: huge })],
      artifacts: [],
    });
    expect(md).toContain("[truncated at 4000 chars]");
    // Ensure we did NOT include the whole thing.
    expect(md.includes("x".repeat(5000))).toBe(false);
  });

  it("groups blackboard entries by category and renders titles + iterations", () => {
    const md = buildSessionTranscript({
      session: baseSession({
        blackboard: [
          { category: "facts", title: "Speech date", content: "2026-02-29", iteration: 1 },
          { category: "facts", title: "Speaker", content: "Premier", iteration: 1 },
          { category: "sources", title: "Hansard", content: "https://example.gov.ab", iteration: 2 },
        ],
      }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Blackboard");
    expect(md).toContain("### facts");
    expect(md).toContain("**Speech date** _(iteration 1)_");
    expect(md).toContain("2026-02-29");
    expect(md).toContain("### sources");
    expect(md).toContain("**Hansard** _(iteration 2)_");
  });

  it("renders the empty-blackboard placeholder", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Blackboard\n\n_No entries._");
  });

  it("renders the scratchpad inside a fenced block, with empty placeholder", () => {
    const empty = buildSessionTranscript({
      session: baseSession({ scratchpad: "" }),
      iterations: [],
      artifacts: [],
    });
    expect(empty).toContain("## Scratchpad\n\n_Empty._");

    const filled = buildSessionTranscript({
      session: baseSession({ scratchpad: "one\ntwo\n" }),
      iterations: [],
      artifacts: [],
    });
    expect(filled).toMatch(/## Scratchpad\n\n```text\none\ntwo\n\n```/);
  });

  it("renders attribute table with primitive and complex values", () => {
    const md = buildSessionTranscript({
      session: baseSession({
        attributes: {
          goal_met: true,
          phase: "review",
          counts: { hits: 3, misses: 0 },
          piped: "value with | pipe and\nnewline",
        },
      }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Attributes");
    expect(md).toContain("| `goal_met` | true |");
    // String attributes render raw (newlines collapsed); only non-string values get JSON-stringified.
    expect(md).toContain("| `phase` | review |");
    // Complex values become inline JSON; pipes must be escaped to avoid breaking the table.
    expect(md).toMatch(/\| `counts` \| .*"hits": 3.*"misses": 0.* \|/);
    // Newline-bearing string with a pipe should have the pipe escaped and the newline removed.
    expect(md).toContain("| `piped` | value with \\| pipe and newline |");
  });

  it("renders an empty-attributes placeholder", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Attributes\n\n_None._");
  });

  it("renders the artifacts table without exposing payload bytes", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [
        {
          id: "art1",
          artifact_type: "image",
          title: "Chart of revenue",
          description: "Generated for question 3.",
          mime_type: "image/png",
          size_bytes: 80450,
          iteration: 2,
          created_at: "2026-05-22T10:01:00.000Z",
        } as ExporterArtifact,
        {
          id: "art2",
          artifact_type: "text",
          title: "Notes",
          description: null,
          mime_type: "text/markdown",
          size_bytes: null,
          iteration: null,
          created_at: "2026-05-22T10:02:00.000Z",
        } as ExporterArtifact,
      ],
    });
    expect(md).toContain("## Artifacts");
    expect(md).toContain("_2 artifacts (metadata only — payload bytes excluded)._");
    expect(md).toContain(
      "| 1 | Chart of revenue | image | image/png | 80450 | 2 | 2026-05-22T10:01:00.000Z |",
    );
    expect(md).toContain(
      "| 2 | Notes | text | text/markdown | — | — | 2026-05-22T10:02:00.000Z |",
    );
    expect(md).toContain("### Artifact descriptions");
    expect(md).toContain("Generated for question 3.");
    // The exporter must never echo a payload field even if mistakenly supplied.
    expect(md).not.toContain("base64");
  });

  it("renders empty-artifacts placeholder when none generated", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Artifacts\n\n_None generated._");
  });

  it("renders a structured final report as a JSON fence", () => {
    const md = buildSessionTranscript({
      session: baseSession({
        finalReport: { summary: "Budget passed.", confidence: 0.94 },
      }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Final report");
    expect(md).toMatch(/```json\n\{\n {2}"summary": "Budget passed\.",\n {2}"confidence": 0\.94\n\}\n```/);
  });

  it("passes a string final report through verbatim", () => {
    const md = buildSessionTranscript({
      session: baseSession({ finalReport: "All done." }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("## Final report\n\nAll done.");
  });

  it("renders an absent final report with a placeholder", () => {
    const md = buildSessionTranscript({
      session: baseSession({ finalReport: null }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("_No final report was produced for this session._");
  });

  it("includes the session error row when present", () => {
    const md = buildSessionTranscript({
      session: baseSession({ error: "Vertex AI 429 rate limited", status: "error" }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("| Error | Vertex AI 429 rate limited |");
    expect(md).toContain("| Status | Error |");
  });

  it("collapses newlines inside error strings to keep table cells valid", () => {
    const md = buildSessionTranscript({
      session: baseSession({ error: "first line\nsecond line\nthird" }),
      iterations: [],
      artifacts: [],
    });
    expect(md).toContain("| Error | first line second line third |");
  });

  it("ends with a single trailing newline", () => {
    const md = buildSessionTranscript({
      session: baseSession(),
      iterations: [],
      artifacts: [],
    });
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("buildExportFilename", () => {
  it("uses the first 8 hex characters of a UUID", () => {
    expect(buildExportFilename("11111111-2222-3333-4444-555555555555")).toBe(
      "abc-session-11111111.md",
    );
  });

  it("strips path traversal and shell-special characters", () => {
    expect(buildExportFilename("../../etc/passwd")).toBe("abc-session-etcpassw.md");
    expect(buildExportFilename("../abc")).toBe("abc-session-abc.md");
    expect(buildExportFilename("a;b|c&d")).toBe("abc-session-abcd.md");
  });

  it("falls back to `session` when the id is unusable", () => {
    expect(buildExportFilename("!!!!!!")).toBe("abc-session-session.md");
    expect(buildExportFilename("")).toBe("abc-session-session.md");
  });

  it("preserves hyphens in short ids", () => {
    expect(buildExportFilename("ab-cd")).toBe("abc-session-ab-cd.md");
  });
});
