/**
 * Manifest + template integrity checks. Catches drift between the JSON
 * data files and the runtime code that consumes them.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getKnownTools } from "../../services/toolDispatcher.js";
import { getTemplateSections, getToolDefinitions } from "../../services/promptBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_MANIFEST = resolve(__dirname, "../toolsManifest.json");
const PROMPT_TEMPLATE = resolve(__dirname, "../systemPromptTemplate.json");

interface ToolDef {
  name: string;
  category: string;
  description: string;
  parameters: { type: string; properties: Record<string, unknown>; required?: string[] };
}

interface PromptSection {
  id: string;
  title: string;
  enabled: boolean;
  content: string;
}

const manifest = JSON.parse(readFileSync(TOOLS_MANIFEST, "utf-8")) as { tools: ToolDef[] };
const template = JSON.parse(readFileSync(PROMPT_TEMPLATE, "utf-8")) as {
  sections: PromptSection[];
  dynamic_sections: Record<string, string>;
};

describe("toolsManifest integrity", () => {
  it("contains at least 25 tools", () => {
    expect(manifest.tools.length).toBeGreaterThanOrEqual(25);
  });

  it("every tool has a unique name", () => {
    const names = manifest.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has parameters with type=object", () => {
    for (const tool of manifest.tools) {
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("every tool name appears in the dispatcher's known tools list", () => {
    const known = new Set(getKnownTools());
    for (const tool of manifest.tools) {
      expect(known.has(tool.name)).toBe(true);
    }
  });

  it("getToolDefinitions matches the manifest one-for-one", () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(manifest.tools.length);
    const defNames = new Set(defs.map((d) => d.name));
    for (const tool of manifest.tools) {
      expect(defNames.has(tool.name)).toBe(true);
    }
  });
});

describe("systemPromptTemplate integrity", () => {
  it("declares at least 8 sections", () => {
    expect(template.sections.length).toBeGreaterThanOrEqual(8);
  });

  it("every section has unique id and non-empty title/content", () => {
    const ids = template.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of template.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.content.length).toBeGreaterThan(0);
    }
  });

  it("declares the required dynamic sections used by promptBuilder", () => {
    for (const key of ["available_tools", "current_state", "user_task", "loop_warning"]) {
      expect(template.dynamic_sections[key]).toBeDefined();
      expect(template.dynamic_sections[key].length).toBeGreaterThan(0);
    }
  });

  it("getTemplateSections returns the manifest sections plus priority", () => {
    const sections = getTemplateSections();
    expect(sections.length).toBe(template.sections.length);
  });
});
