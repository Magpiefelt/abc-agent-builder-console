import { describe, it, expect } from "vitest";
import { LoopDetector } from "../loopDetector.js";

function recordIdentical(detector: LoopDetector, count: number): void {
  // Identical thinking + tool calls → exact repetition, tool pattern, n-gram,
  // semantic similarity, and progress stall all detect simultaneously. This
  // is the scenario that previously inflated interventionCount by ~5×.
  for (let i = 1; i <= count; i++) {
    detector.recordIteration({
      iteration: i,
      thinking: "Trying the same approach again with the same parameters and the same reasoning.",
      toolCalls: [{ tool: "web_scrape", params: { url: "https://example.com" } }],
      blackboardUpdates: 0,
      status: "running",
    });
  }
}

describe("LoopDetector", () => {
  it("only counts one intervention per detect() call even when multiple levels fire", () => {
    const detector = new LoopDetector({ maxInterventionsBeforeStop: 4 });
    recordIdentical(detector, 6);

    // First detect() should produce one intervention, not five — even though
    // every level is reporting a match. shouldForceStop must stay false at
    // this point because interventionCount = 1 < 4.
    const first = detector.detect();
    expect(first.detected).toBe(true);
    expect(first.shouldForceStop).toBe(false);
    expect(first.intervention.length).toBeGreaterThan(0);
    expect(detector.getMetrics().interventionsSent).toBe(1);
  });

  it("escalates to forced stop after exactly maxInterventionsBeforeStop detect() calls", () => {
    const detector = new LoopDetector({ maxInterventionsBeforeStop: 4 });
    recordIdentical(detector, 6);

    // Each detect() returns intervention text; with the bug present this loop
    // would force-stop on the very first call.
    detector.detect();
    detector.detect();
    detector.detect();
    detector.detect();
    const fifth = detector.detect();

    expect(fifth.detected).toBe(true);
    expect(fifth.shouldForceStop).toBe(true);
    expect(detector.getMetrics().interventionsSent).toBe(5);
  });

  it("returns no detection when history is shorter than minIterations", () => {
    const detector = new LoopDetector({ minIterations: 3 });
    recordIdentical(detector, 2);
    expect(detector.detect().detected).toBe(false);
    expect(detector.getMetrics().interventionsSent).toBe(0);
  });

  it("reset() clears history and intervention count", () => {
    const detector = new LoopDetector();
    recordIdentical(detector, 6);
    detector.detect();
    expect(detector.getMetrics().interventionsSent).toBe(1);

    detector.reset();
    // After reset, the next detect() with a fresh recording starts clean.
    recordIdentical(detector, 6);
    const after = detector.detect();
    expect(after.detected).toBe(true);
    expect(after.shouldForceStop).toBe(false);
  });
});
