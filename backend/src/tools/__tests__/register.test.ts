import { describe, it, expect } from "vitest";
import { registerAllTools } from "../register.js";
import { getRegisteredToolCount, getKnownTools } from "../../services/toolDispatcher.js";

describe("registerAllTools", () => {
  it("populates the dispatcher registry with at least 15 edge tools", () => {
    registerAllTools();
    expect(getRegisteredToolCount()).toBeGreaterThanOrEqual(15);
  });

  it("is idempotent — calling twice does not error or duplicate", () => {
    registerAllTools();
    const count1 = getRegisteredToolCount();
    registerAllTools();
    const count2 = getRegisteredToolCount();
    expect(count2).toBe(count1);
  });

  it("registers tools that appear in getKnownTools", () => {
    registerAllTools();
    const known = getKnownTools();
    for (const expected of ["brave_search", "web_scrape", "read_github_repo", "pdf_extract_text"]) {
      expect(known).toContain(expected);
    }
  });
});
