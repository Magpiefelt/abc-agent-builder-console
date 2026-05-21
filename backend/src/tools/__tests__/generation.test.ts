/**
 * Unit tests for the generation tools (image_generation, elevenlabs_tts).
 *
 * We exercise validation logic and configuration checks only — no real API
 * calls are made. Provider calls (Ent Tools, Gemini, ElevenLabs) are
 * integration-level concerns that belong in the eval / smoke-test suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { imageGeneration, elevenlabsTts } from "../generation.js";
import type { ToolContext } from "../../services/toolDispatcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(): ToolContext {
  return {
    userId: "user-gen-test",
    sessionId: "session-gen-test",
    ministryCode: "INFRA",
    classification: "unclassified",
    memory: { blackboard: [], scratchpad: "", attributes: {} },
  };
}

// Suppress logger noise during tests.
vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// image_generation — input validation
// ---------------------------------------------------------------------------

describe("imageGeneration — input validation", () => {
  it("returns error when 'prompt' is missing", async () => {
    const result = await imageGeneration({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/prompt.*required/i);
  });

  it("returns error when prompt exceeds 2000 characters", async () => {
    const result = await imageGeneration(
      { prompt: "A".repeat(2001) },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/2000 character/i);
  });

  it("returns error when context is missing", async () => {
    const result = await imageGeneration({ prompt: "A cat" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ToolContext/i);
  });

  it("returns config error when no provider API key is set", async () => {
    // With neither ENT_TOOLS_API_KEY nor GOOGLE_AI_API_KEY set (CI default),
    // the tool should degrade gracefully instead of throwing.
    const originalEntKey = process.env.ENT_TOOLS_API_KEY;
    const originalGoogleKey = process.env.GOOGLE_AI_API_KEY;
    delete process.env.ENT_TOOLS_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;

    try {
      const result = await imageGeneration({ prompt: "A sunset" }, makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not configured|ENT_TOOLS|GOOGLE_AI/i);
    } finally {
      if (originalEntKey !== undefined) process.env.ENT_TOOLS_API_KEY = originalEntKey;
      if (originalGoogleKey !== undefined) process.env.GOOGLE_AI_API_KEY = originalGoogleKey;
    }
  });
});

// ---------------------------------------------------------------------------
// elevenlabs_tts — input validation
// ---------------------------------------------------------------------------

describe("elevenlabsTts — input validation", () => {
  it("returns error when 'text' is missing", async () => {
    // The 'text' check fires before the API key check.
    const result = await elevenlabsTts({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/text.*required/i);
  });

  it("returns config error when ELEVENLABS_API_KEY is not set (CI default)", async () => {
    // In CI, ELEVENLABS_API_KEY is not configured. The tool must degrade
    // gracefully rather than throw.
    const result = await elevenlabsTts({ text: "Hello world" }, makeContext());
    expect(result.success).toBe(false);
    // Either the key check fires (no key set) or the context check fires.
    // Either is a safe, expected outcome.
    expect(result.error).toMatch(/ELEVENLABS_API_KEY|ToolContext|authenticated/i);
  });

  it("returns a failure (not a crash) for long text when API key is absent", async () => {
    // Regardless of whether the API key or text-length check fires first, the
    // tool must never throw — it must return a structured failure object.
    const result = await elevenlabsTts({ text: "A".repeat(5001) }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });

  it("does not throw when context is omitted entirely", async () => {
    // The tool must handle missing context gracefully (returns failure).
    const result = await elevenlabsTts({ text: "Hello" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
