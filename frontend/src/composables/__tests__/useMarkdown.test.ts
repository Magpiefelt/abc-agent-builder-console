import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../useMarkdown";

describe("renderMarkdown", () => {
  it("returns empty string for null/undefined/empty input", () => {
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
    expect(renderMarkdown("")).toBe("");
  });

  it("renders headings, bold, and lists", () => {
    const html = renderMarkdown("# Title\n\n**bold** and a list:\n\n- one\n- two");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
  });

  it("strips raw <script> tags via DOMPurify", () => {
    const html = renderMarkdown('Hello <script>alert("xss")</script>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert(");
  });

  it("strips javascript: URLs from rendered links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("strips event-handler attributes (e.g. onclick)", () => {
    const html = renderMarkdown('Hello <a href="https://example.com" onclick="alert(1)">link</a>');
    expect(html).not.toMatch(/onclick=/i);
  });

  it("preserves safe https links", () => {
    const html = renderMarkdown("[Alberta](https://alberta.ca)");
    expect(html).toContain('href="https://alberta.ca"');
  });
});
