import { describe, it, expect, beforeEach } from "vitest";
import { LoopDetector, hashContent } from "../loopDetector.js";
import type { IterationRecord } from "../loopDetector.js";

type RecordInput = Omit<IterationRecord, "contentHash" | "toolSignatures">;

function buildRecord(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    iteration: 1,
    thinking: "Default thinking text.",
    toolCalls: [],
    blackboardUpdates: 0,
    status: "running",
    ...overrides,
  };
}

/** Generate a unique-ish thinking string that shares no >2-char tokens with the others. */
function uniqueThinking(seed: number): string {
  const slot = (n: number) => `T${seed}_${n}__${seed * 7919 + n}`;
  return `${slot(1)} ${slot(2)} ${slot(3)} ${slot(4)} ${slot(5)}`;
}

describe("loopDetector — utility", () => {
  it("produces a stable hash regardless of whitespace and case", () => {
    expect(hashContent("Hello world")).toBe(hashContent("hello   world"));
    expect(hashContent("HELLO WORLD")).toBe(hashContent("hello world"));
  });

  it("produces different hashes for different content", () => {
    expect(hashContent("apple")).not.toBe(hashContent("banana"));
  });
});

describe("loopDetector — minIterations gate", () => {
  it("does not detect anything before the minimum iteration count", () => {
    const detector = new LoopDetector({ minIterations: 3 });
    detector.recordIteration(buildRecord({ iteration: 1 }));
    detector.recordIteration(buildRecord({ iteration: 2 }));
    expect(detector.detect().detected).toBe(false);
  });
});

describe("loopDetector — Level 1: exact repetition", () => {
  it("detects when the same thinking+toolCalls hash repeats", () => {
    const detector = new LoopDetector({ minIterations: 2, exactRepeatThreshold: 2 });
    for (let i = 0; i < 3; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: "Same exact thought.",
        toolCalls: [{ tool: "x", params: { q: "foo" } }],
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBe(1);
    expect(result.intervention.length).toBeGreaterThan(0);
  });

  it("does not detect when each iteration's content is truly unique", () => {
    const detector = new LoopDetector({ minIterations: 2 });
    for (let i = 0; i < 5; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: uniqueThinking(i),
        toolCalls: [{ tool: `tool_${i}`, params: { uniq: `value_${i}_${Math.random()}` } }],
        blackboardUpdates: 1,
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(false);
  });
});

describe("loopDetector — Level 2: repetitive tool patterns (suppressing higher-confidence levels)", () => {
  it("fires when same tool+params is called, with detection reported", () => {
    const detector = new LoopDetector({
      minIterations: 3,
      // Pump up exact-repeat threshold so it doesn't outrank Level 2
      exactRepeatThreshold: 999,
      toolPatternThreshold: 3,
      ngramRepeatThreshold: 999,
      similarityThreshold: 0.99,
      progressStallThreshold: 999,
    });
    for (let i = 0; i < 4; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: uniqueThinking(i),
        toolCalls: [{ tool: "brave_search", params: { query: "alberta" } }],
        blackboardUpdates: 1,
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBe(2);
    expect(result.description).toContain("brave_search");
  });
});

describe("loopDetector — Level 3: n-gram tool sequences", () => {
  it("detects repeated tool-call sequences", () => {
    const detector = new LoopDetector({
      minIterations: 3,
      ngramSize: 2,
      ngramRepeatThreshold: 2,
      exactRepeatThreshold: 999,
      toolPatternThreshold: 999,
      similarityThreshold: 0.99,
      progressStallThreshold: 999,
    });
    for (let i = 0; i < 4; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: uniqueThinking(i),
        toolCalls: [
          { tool: "brave_search", params: { query: `q${i}` } },
          { tool: "web_scrape", params: { url: `u${i}` } },
        ],
        blackboardUpdates: 1,
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBe(3);
  });
});

describe("loopDetector — Level 4: semantic similarity", () => {
  it("detects when consecutive reasoning is highly similar", () => {
    const detector = new LoopDetector({
      minIterations: 3,
      similarityThreshold: 0.5,
      exactRepeatThreshold: 999,
      toolPatternThreshold: 999,
      ngramRepeatThreshold: 999,
      progressStallThreshold: 999,
    });
    const base = "agent searching for population data about edmonton calgary alberta";
    for (let i = 0; i < 4; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: `${base} attempt ${i}`,
        toolCalls: [{ tool: `tool_${i}`, params: { x: i } }],
        blackboardUpdates: 1,
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBe(4);
  });
});

describe("loopDetector — Level 5: progress stall", () => {
  it("detects when no blackboard updates happen across many iterations", () => {
    const detector = new LoopDetector({
      minIterations: 3,
      progressStallThreshold: 5,
      exactRepeatThreshold: 999,
      toolPatternThreshold: 999,
      ngramRepeatThreshold: 999,
      similarityThreshold: 0.99,
    });
    for (let i = 0; i < 6; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: uniqueThinking(i),
        toolCalls: [{ tool: `tool_${i}`, params: { x: i } }],
        blackboardUpdates: 0,
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBe(5);
  });

  it("does not detect stall when blackboard is being updated", () => {
    const detector = new LoopDetector({
      minIterations: 3,
      progressStallThreshold: 3,
      exactRepeatThreshold: 999,
      toolPatternThreshold: 999,
      ngramRepeatThreshold: 999,
      similarityThreshold: 0.99,
    });
    for (let i = 0; i < 5; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: uniqueThinking(i),
        blackboardUpdates: 1,
      }));
    }
    expect(detector.detect().detected).toBe(false);
  });
});

describe("loopDetector — intervention escalation", () => {
  it("returns increasingly firm interventions on each detection", () => {
    const detector = new LoopDetector({ minIterations: 2, exactRepeatThreshold: 2 });
    const interventions: string[] = [];
    for (let pass = 0; pass < 3; pass++) {
      detector.recordIteration(buildRecord({
        iteration: pass + 1,
        thinking: "Same exact thinking.",
        toolCalls: [{ tool: "x", params: { y: 1 } }],
      }));
      detector.recordIteration(buildRecord({
        iteration: pass + 100,
        thinking: "Same exact thinking.",
        toolCalls: [{ tool: "x", params: { y: 1 } }],
      }));
      const r = detector.detect();
      if (r.detected) interventions.push(r.intervention);
    }
    expect(interventions.length).toBeGreaterThanOrEqual(2);
    const tail = interventions[interventions.length - 1];
    expect(tail).toMatch(/STOP|CRITICAL|FINAL|WARNING|MUST/i);
  });

  it("forces stop after maxInterventionsBeforeStop", () => {
    const detector = new LoopDetector({
      minIterations: 2,
      exactRepeatThreshold: 2,
      maxInterventionsBeforeStop: 2,
    });
    let forcedAt = -1;
    for (let i = 0; i < 8; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: "constant thinking.",
        toolCalls: [{ tool: "t", params: { p: 1 } }],
      }));
      const r = detector.detect();
      if (r.shouldForceStop) {
        forcedAt = i;
        break;
      }
    }
    expect(forcedAt).toBeGreaterThanOrEqual(0);
    const metrics = detector.getMetrics();
    expect(metrics.forcedStops).toBeGreaterThan(0);
  });
});

describe("loopDetector — reset", () => {
  let detector: LoopDetector;
  beforeEach(() => {
    detector = new LoopDetector({ minIterations: 2, exactRepeatThreshold: 2 });
  });

  it("hard reset clears history and intervention count", () => {
    detector.recordIteration(buildRecord({ thinking: "same", toolCalls: [{ tool: "t", params: {} }] }));
    detector.recordIteration(buildRecord({ thinking: "same", toolCalls: [{ tool: "t", params: {} }] }));
    detector.detect();
    detector.reset();
    expect(detector.getHistoryLength()).toBe(0);
    expect(detector.detect().detected).toBe(false);
  });

  it("soft reset preserves history", () => {
    detector.recordIteration(buildRecord({ thinking: "same", toolCalls: [{ tool: "t", params: {} }] }));
    detector.recordIteration(buildRecord({ thinking: "same", toolCalls: [{ tool: "t", params: {} }] }));
    detector.detect();
    const before = detector.getHistoryLength();
    detector.softReset();
    expect(detector.getHistoryLength()).toBe(before);
  });
});

describe("loopDetector — metrics", () => {
  it("tracks total iterations analyzed and detection counts", () => {
    const detector = new LoopDetector({ minIterations: 2, exactRepeatThreshold: 2 });
    for (let i = 0; i < 4; i++) {
      detector.recordIteration(buildRecord({
        iteration: i + 1,
        thinking: "looping",
        toolCalls: [{ tool: "x", params: {} }],
      }));
      detector.detect();
    }
    const m = detector.getMetrics();
    expect(m.totalIterationsAnalyzed).toBe(4);
    expect(m.detectionsTriggered).toBeGreaterThan(0);
  });
});
