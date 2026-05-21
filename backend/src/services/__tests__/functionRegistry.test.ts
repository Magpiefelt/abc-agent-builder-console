/**
 * Unit tests for the functionRegistry service.
 *
 * The function registry provides 44 deterministic transforms invokable by
 * Function nodes in the workflow canvas. Tests cover representative functions
 * from each category (text-transform, math, parse, format, branch) plus
 * the unknown-function error path and the catalog/branch-detection helpers.
 */

import { describe, it, expect } from "vitest";
import { runFunction, getCatalog, isBranchFunction } from "../functionRegistry.js";

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

describe("functionRegistry — getCatalog()", () => {
  it("returns a non-empty array of catalog entries", () => {
    const catalog = getCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it("every entry has name, category, description, params, outputType", () => {
    const catalog = getCatalog();
    for (const entry of catalog) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.category).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(Array.isArray(entry.params)).toBe(true);
      expect(typeof entry.outputType).toBe("string");
    }
  });
});

describe("functionRegistry — isBranchFunction()", () => {
  it("returns true for known branch functions", () => {
    // Branch functions are used by the executor to prune subtrees.
    const catalog = getCatalog();
    const branchFunctions = catalog.filter((e) => e.category === "branch");
    for (const entry of branchFunctions) {
      expect(isBranchFunction(entry.name)).toBe(true);
    }
  });

  it("returns false for non-branch functions", () => {
    expect(isBranchFunction("to_upper")).toBe(false);
    expect(isBranchFunction("add")).toBe(false);
    expect(isBranchFunction("json_parse")).toBe(false);
  });

  it("returns false for unknown function names", () => {
    expect(isBranchFunction("does_not_exist")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown function
// ---------------------------------------------------------------------------

describe("functionRegistry — runFunction — unknown name", () => {
  it("throws for an unregistered function name", async () => {
    await expect(runFunction("does_not_exist", "input", {})).rejects.toThrow(/Unknown function/);
  });
});

// ---------------------------------------------------------------------------
// Text-transform category
// ---------------------------------------------------------------------------

describe("functionRegistry — text-transform functions", () => {
  it("to_upper converts input to uppercase", async () => {
    expect(await runFunction("to_upper", "hello world", {})).toBe("HELLO WORLD");
  });

  it("to_lower converts input to lowercase", async () => {
    expect(await runFunction("to_lower", "HELLO WORLD", {})).toBe("hello world");
  });

  it("trim removes leading and trailing whitespace", async () => {
    expect(await runFunction("trim", "  hello  ", {})).toBe("hello");
  });

  it("slugify converts a phrase to a URL-safe slug", async () => {
    const result = await runFunction("slugify", "Hello World!", {});
    expect(result).toBe("hello-world");
  });

  it("truncate shortens a string to the given max length with suffix", async () => {
    const result = await runFunction("truncate", "Hello World", { maxLength: 8, suffix: "…" });
    expect(result).toBe("Hello Wo…");
  });

  it("truncate returns the full string when it fits within maxLength", async () => {
    const result = await runFunction("truncate", "Hi", { maxLength: 10 });
    expect(result).toBe("Hi");
  });

  it("replace substitutes a search term with a replacement", async () => {
    // The 'replace' function uses 'find' (not 'pattern') for the search term.
    const result = await runFunction("replace", "foo bar foo", { find: "foo", replacement: "baz" });
    expect(result).toBe("baz bar baz");
  });

  it("template_render fills {{key}} placeholders from context", async () => {
    const result = await runFunction("template_render", { greeting: "Hello", name: "Alberta" }, {
      template: "{{greeting}}, {{name}}!",
    });
    expect(result).toBe("Hello, Alberta!");
  });

  it("concat adds a prefix and suffix to the input with a separator", async () => {
    // concat uses { prefix, suffix, separator } — not a 'parts' array.
    const result = await runFunction("concat", "World", { prefix: "Hello", separator: " " });
    expect(result).toBe("Hello World");
  });

  it("markdown_to_text strips markdown syntax", async () => {
    const result = await runFunction("markdown_to_text", "# Heading\n\nParagraph **bold**.", {});
    expect(typeof result).toBe("string");
    expect(result as string).not.toContain("**");
    expect(result as string).not.toContain("# ");
  });
});

// ---------------------------------------------------------------------------
// Math category
// ---------------------------------------------------------------------------

describe("functionRegistry — math functions", () => {
  it("add returns input + value", async () => {
    expect(await runFunction("add", 10, { value: 5 })).toBe(15);
  });

  it("subtract returns input - value", async () => {
    expect(await runFunction("subtract", 10, { value: 3 })).toBe(7);
  });

  it("multiply returns input * value", async () => {
    expect(await runFunction("multiply", 4, { value: 3 })).toBe(12);
  });

  it("divide returns input / value", async () => {
    expect(await runFunction("divide", 10, { value: 4 })).toBe(2.5);
  });

  it("divide throws on division by zero", async () => {
    await expect(runFunction("divide", 10, { value: 0 })).rejects.toThrow(/zero/i);
  });

  it("round rounds to the specified decimal places", async () => {
    expect(await runFunction("round", 3.14159, { decimals: 2 })).toBe(3.14);
  });

  it("clamp constrains value between min and max", async () => {
    expect(await runFunction("clamp", 5, { min: 1, max: 3 })).toBe(3);
    expect(await runFunction("clamp", -5, { min: 0, max: 10 })).toBe(0);
    expect(await runFunction("clamp", 5, { min: 0, max: 10 })).toBe(5);
  });

  it("sum_array sums an array of numbers", async () => {
    expect(await runFunction("sum_array", [1, 2, 3, 4, 5], {})).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Parse category
// ---------------------------------------------------------------------------

describe("functionRegistry — parse functions", () => {
  it("json_parse parses a JSON string into an object", async () => {
    expect(await runFunction("json_parse", '{"a":1}', {})).toEqual({ a: 1 });
  });

  it("json_stringify serializes an object to JSON", async () => {
    const result = await runFunction("json_stringify", { a: 1 }, { pretty: false });
    expect(result).toBe('{"a":1}');
  });

  it("regex_match returns the match array when pattern matches", async () => {
    // regex_match returns `[...matchArray]` (first match + groups), not a boolean.
    const result = await runFunction("regex_match", "Alberta", { pattern: "^Alberta$" });
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[])[0]).toBe("Alberta");
  });

  it("regex_match returns null when pattern does not match", async () => {
    const result = await runFunction("regex_match", "Ontario", { pattern: "^Alberta$" });
    expect(result).toBeNull();
  });

  it("regex_extract_all returns all full matches (no capture groups)", async () => {
    // regex_extract_all returns the full match string (m[0]), not capture groups.
    const result = await runFunction("regex_extract_all", "cat 1, cat 2, cat 3", {
      pattern: "cat \\d+",
    });
    expect(result).toEqual(["cat 1", "cat 2", "cat 3"]);
  });

  it("url_parse extracts host and pathname (uses 'host' not 'hostname')", async () => {
    // url_parse returns { protocol, host, pathname, query, hash }
    const result = await runFunction("url_parse", "https://gov.ab.ca/services?q=1", {}) as Record<string, unknown>;
    expect(result.host).toBe("gov.ab.ca");
    expect(result.pathname).toBe("/services");
    expect((result.query as Record<string, string>).q).toBe("1");
  });

  it("date_parse_iso returns an epoch millisecond number", async () => {
    // date_parse_iso returns a number (epoch ms), not an object with year/month/day.
    const result = await runFunction("date_parse_iso", "2026-05-21T00:00:00Z", {}) as number;
    expect(typeof result).toBe("number");
    expect(result).toBe(new Date("2026-05-21T00:00:00Z").getTime());
  });
});

// ---------------------------------------------------------------------------
// Format category
// ---------------------------------------------------------------------------

describe("functionRegistry — format functions", () => {
  it("number_format formats a number with thousands separators", async () => {
    const result = await runFunction("number_format", 1234567, { decimals: 0 });
    expect(typeof result).toBe("string");
    expect(result as string).toContain("1,234,567");
  });

  it("currency_cad formats a number as CAD currency", async () => {
    const result = await runFunction("currency_cad", 1234.5, {});
    expect(typeof result).toBe("string");
    expect(result as string).toContain("1,234.50");
  });
});
