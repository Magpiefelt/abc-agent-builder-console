import { describe, it, expect } from "vitest";
import { LoopDetector, hashContent, type IterationRecord } from "../loopDetector.js";

type Iter = Omit<IterationRecord, "contentHash" | "toolSignatures">;

const makeIter = (
  iteration: number,
  partial: Partial<Iter> = {},
): Iter => ({
  iteration,
  thinking: partial.thinking ?? `Iteration ${iteration} thinking`,
  toolCalls: partial.toolCalls ?? [],
  blackboardUpdates: partial.blackboardUpdates ?? 1,
  status: partial.status ?? "in_progress",
});

describe("hashContent", () => {
  it("returns identical hashes for whitespace-normalized identical content", () => {
    expect(hashContent("hello world")).toBe(hashContent("  HELLO   world  "));
  });

  it("returns different hashes for different content", () => {
    expect(hashContent("alpha")).not.toBe(hashContent("beta"));
  });
});

describe("LoopDetector — below minIterations", () => {
  it("returns no detection until minIterations records are present", () => {
    const detector = new LoopDetector({ minIterations: 3 });
    detector.recordIteration(makeIter(1));
    detector.recordIteration(makeIter(2));
    const result = detector.detect();
    expect(result.detected).toBe(false);
  });
});

describe("LoopDetector — Level 1 exact repetition", () => {
  it("flags exact content repetition once threshold is reached", () => {
    const detector = new LoopDetector({
      minIterations: 2,
      exactRepeatThreshold: 2,
    });
    const repeat = makeIter(1, { thinking: "thinking the same thing" });
    detector.recordIteration(repeat);
    detector.recordIteration({ ...repeat, iteration: 2 });
    detector.recordIteration({ ...repeat, iteration: 3 });
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBeGreaterThanOrEqual(1);
    expect(result.intervention.length).toBeGreaterThan(0);
  });
});

// Word sets engineered to have near-zero Jaccard overlap so they don't trip Level 4.
const VARIED_THINKING = [
  "Acquiring satellite telemetry from orbital station alpha",
  "Compiling regulatory framework references for hearing",
  "Drafting transit pricing analysis chart visualization output",
  "Reviewing healthcare administrative quarterly budget forecast",
  "Examining wildlife conservation policy implementation results",
  "Inspecting renewable energy infrastructure scaling decisions",
];

describe("LoopDetector — Level 2 tool pattern repetition", () => {
  it("flags repeated identical tool calls", () => {
    const detector = new LoopDetector({
      minIterations: 2,
      toolPatternThreshold: 3,
      exactRepeatThreshold: 99,    // disable level 1
      ngramRepeatThreshold: 99,    // disable level 3
      similarityThreshold: 0.99,   // disable level 4 (semantic)
    });
    for (let i = 1; i <= 4; i++) {
      detector.recordIteration(makeIter(i, {
        thinking: VARIED_THINKING[i - 1],
        toolCalls: [{ tool: "brave_search", params: { query: "abc" } }],
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.description).toContain("brave_search");
  });

  it("does NOT flag varying tool calls", () => {
    const detector = new LoopDetector({
      minIterations: 2,
      toolPatternThreshold: 3,
      exactRepeatThreshold: 99,
      ngramRepeatThreshold: 99,
      similarityThreshold: 0.99,
      progressStallThreshold: 99,
    });
    for (let i = 1; i <= 4; i++) {
      detector.recordIteration(makeIter(i, {
        thinking: VARIED_THINKING[i - 1],
        toolCalls: [{ tool: "brave_search", params: { query: `unique-${i}` } }],
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(false);
  });
});

describe("LoopDetector — Level 5 progress stall", () => {
  it("flags zero blackboard updates over progressStallThreshold iterations", () => {
    const detector = new LoopDetector({
      minIterations: 2,
      progressStallThreshold: 3,
      // disable louder levels so we exercise stall specifically
      exactRepeatThreshold: 99,
      toolPatternThreshold: 99,
      ngramRepeatThreshold: 99,
      similarityThreshold: 0.99,
    });
    for (let i = 1; i <= 4; i++) {
      detector.recordIteration(makeIter(i, {
        thinking: VARIED_THINKING[i - 1],
        toolCalls: [{ tool: "get_time", params: { tz: `T${i}` } }],
        blackboardUpdates: 0,
      }));
    }
    const result = detector.detect();
    expect(result.detected).toBe(true);
    expect(result.level).toBe(5);
  });
});

describe("LoopDetector — reset() and metrics", () => {
  it("reset() clears history and intervention count", () => {
    const detector = new LoopDetector({ minIterations: 2, exactRepeatThreshold: 2 });
    detector.recordIteration(makeIter(1, { thinking: "x" }));
    detector.recordIteration(makeIter(2, { thinking: "x" }));
    detector.detect(); // triggers intervention count
    expect(detector.getHistoryLength()).toBeGreaterThan(0);
    detector.reset();
    expect(detector.getHistoryLength()).toBe(0);
  });

  it("getMetrics tracks total iterations analyzed", () => {
    const detector = new LoopDetector();
    detector.recordIteration(makeIter(1));
    detector.recordIteration(makeIter(2));
    expect(detector.getMetrics().totalIterationsAnalyzed).toBe(2);
  });
});
