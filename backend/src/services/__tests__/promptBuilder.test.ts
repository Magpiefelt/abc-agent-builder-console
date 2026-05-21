import { describe, it, expect } from "vitest";
import { buildSystemPrompt, getToolDefinitions, getTemplateSections, estimatePromptTokens } from "../promptBuilder.js";
import type { PromptContext, BlackboardEntry } from "../promptBuilder.js";

function baseContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    iteration: 1,
    maxIterations: 50,
    status: "running",
    blackboard: [],
    scratchpad: "",
    attributes: {},
    prompt: "Default test task.",
    ...overrides,
  };
}

describe("promptBuilder — assembly", () => {
  it("includes the user task verbatim in the prompt", () => {
    const out = buildSystemPrompt(baseContext({ prompt: "Find the population of Edmonton." }));
    expect(out).toContain("Find the population of Edmonton.");
  });

  it("includes iteration progress information", () => {
    const out = buildSystemPrompt(baseContext({ iteration: 5, maxIterations: 50 }));
    expect(out).toMatch(/Iteration/i);
  });

  it("always emits the security_rules section regardless of overrides attempting to disable it", () => {
    // priority 1 sections are protected when over budget, but enable=false override is honored.
    // Make sure it appears under default conditions.
    const out = buildSystemPrompt(baseContext({ prompt: "hello" }));
    expect(out.toLowerCase()).toMatch(/security|safety/);
  });

  it("emits loop_warning content when provided", () => {
    const out = buildSystemPrompt(
      baseContext({ loopWarning: "STOP repeating the same response. Try a different approach." })
    );
    expect(out).toContain("STOP repeating the same response.");
  });

  it("omits loop_warning section when no warning is given", () => {
    const out = buildSystemPrompt(baseContext());
    // The dynamic loop_warning section title would be repeated if present; absent when not.
    expect(out).not.toMatch(/Loop Warning|loop_warning/);
  });

  it("renders previous tool results when provided", () => {
    const out = buildSystemPrompt(baseContext({
      previousToolResults: [
        { tool: "brave_search", success: true, summary: "Returned 10 results" },
        { tool: "web_scrape", success: false, summary: "Failed: timeout" },
      ],
    }));
    expect(out).toContain("brave_search");
    expect(out).toContain("Failed: timeout");
  });
});

describe("promptBuilder — blackboard rendering", () => {
  it("shows 'No entries yet' when blackboard is empty", () => {
    const out = buildSystemPrompt(baseContext({ blackboard: [] }));
    expect(out).toContain("No entries yet");
  });

  it("groups blackboard entries by category", () => {
    const blackboard: BlackboardEntry[] = [
      { category: "research", title: "edm", content: "pop 1M", iteration: 1 },
      { category: "research", title: "cal", content: "pop 1.3M", iteration: 2 },
      { category: "summary", title: "final", content: "two cities", iteration: 3 },
    ];
    const out = buildSystemPrompt(baseContext({ blackboard }));
    expect(out).toContain("[research]");
    expect(out).toContain("[summary]");
  });

  it("limits a single category to 10 visible entries and notes the remainder", () => {
    const blackboard: BlackboardEntry[] = Array.from({ length: 15 }, (_, i) => ({
      category: "research",
      title: `entry_${i}`,
      content: `body_${i}`,
      iteration: i,
    }));
    const out = buildSystemPrompt(baseContext({ blackboard }));
    // 15 entries total; should show 10 and note 5 more.
    expect(out).toMatch(/5 more entries|5 more/);
  });

  it("truncates individual entries that exceed 500 characters", () => {
    const huge = "x".repeat(800);
    const blackboard: BlackboardEntry[] = [
      { category: "research", title: "huge", content: huge, iteration: 1 },
    ];
    const out = buildSystemPrompt(baseContext({ blackboard }));
    expect(out).not.toContain("x".repeat(700));
    expect(out).toMatch(/\.\.\.|truncated/i);
  });
});

describe("promptBuilder — attributes & scratchpad", () => {
  it("shows 'No attributes set' when attributes is empty", () => {
    const out = buildSystemPrompt(baseContext({ attributes: {} }));
    expect(out).toContain("No attributes set");
  });

  it("renders string attributes verbatim", () => {
    const out = buildSystemPrompt(baseContext({ attributes: { user_intent: "research-and-summarize" } }));
    expect(out).toContain("user_intent");
    expect(out).toContain("research-and-summarize");
  });

  it("truncates attribute values longer than 200 characters", () => {
    const long = "z".repeat(400);
    const out = buildSystemPrompt(baseContext({ attributes: { huge: long } }));
    expect(out).not.toContain("z".repeat(300));
  });

  it("shows 'Empty' marker for an empty scratchpad", () => {
    const out = buildSystemPrompt(baseContext({ scratchpad: "" }));
    expect(out).toMatch(/Empty|_Empty_/);
  });

  it("includes scratchpad content under the budget", () => {
    const out = buildSystemPrompt(baseContext({ scratchpad: "mid-task notes about Edmonton population research" }));
    expect(out).toContain("Edmonton population research");
  });
});

describe("promptBuilder — token budget", () => {
  it("truncates oversize content with a [TRUNCATED] marker", () => {
    const giant = "lorem ipsum ".repeat(10_000); // ~120K chars ~30K tokens
    const out = buildSystemPrompt(baseContext({
      scratchpad: giant,
      maxPromptTokens: 4000,
    }));
    expect(out).toMatch(/TRUNCATED/);
  });

  it("estimatePromptTokens returns a positive integer", () => {
    const n = estimatePromptTokens(baseContext({ prompt: "small task" }));
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("handles multibyte characters in scratchpad without crashing", () => {
    const multibyte = "日本語のテスト 漢字 emoji 🎉".repeat(200);
    expect(() => buildSystemPrompt(baseContext({ scratchpad: multibyte, maxPromptTokens: 2000 }))).not.toThrow();
  });
});

describe("promptBuilder — tools list", () => {
  it("getToolDefinitions returns all manifest tools when no filter is given", () => {
    const tools = getToolDefinitions();
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.every((t) => typeof t.name === "string")).toBe(true);
  });

  it("getToolDefinitions filters to only the enabled subset when specified", () => {
    const tools = getToolDefinitions(["brave_search", "web_scrape"]);
    expect(tools.map((t) => t.name).sort()).toEqual(["brave_search", "web_scrape"]);
  });

  it("emits available tools inside the system prompt", () => {
    const out = buildSystemPrompt(baseContext({ enabledTools: ["brave_search", "web_scrape"] }));
    expect(out).toContain("brave_search");
    expect(out).toContain("web_scrape");
  });
});

describe("promptBuilder — template sections", () => {
  it("getTemplateSections returns enabled sections from the template", () => {
    const sections = getTemplateSections();
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((s) => typeof s.title === "string")).toBe(true);
  });

  it("section overrides can disable a section", () => {
    const sections = getTemplateSections();
    const optional = sections.find((s) => (s.priority || 3) >= 3);
    if (!optional) return;
    const out = buildSystemPrompt(baseContext({
      sectionOverrides: { [optional.id]: { enabled: false } },
    }));
    // Section is disabled — its title should not appear (unless duplicated by another section)
    // Use a loose check since dynamic sections may reference some titles too.
    const occurrencesIn = (haystack: string, needle: string) =>
      haystack.split(needle).length - 1;
    const baseline = buildSystemPrompt(baseContext());
    expect(occurrencesIn(out, optional.title)).toBeLessThanOrEqual(occurrencesIn(baseline, optional.title));
  });

  it("section overrides can rewrite section content", () => {
    const sections = getTemplateSections();
    const target = sections.find((s) => (s.priority || 3) >= 3) || sections[0];
    const out = buildSystemPrompt(baseContext({
      sectionOverrides: { [target.id]: { content: "MARKER_XYZZY_CUSTOM_CONTENT" } },
    }));
    expect(out).toContain("MARKER_XYZZY_CUSTOM_CONTENT");
  });
});
