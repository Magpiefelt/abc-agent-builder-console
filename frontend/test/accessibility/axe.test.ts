/**
 * Accessibility audit using axe-core under jsdom.
 *
 * For each top-level route, the corresponding view is mounted and scanned for
 * WCAG 2.1 Level A + AA violations. The suite FAILS on any violation with
 * `impact: "serious"` or `"critical"`.
 *
 * jsdom limitations:
 * - `color-contrast` is disabled here because jsdom does not compute styles
 *   reliably enough to evaluate contrast ratios. Visual contrast is verified
 *   manually and documented in docs/quality/accessibility_audit.md.
 * - `region` is downgraded — these are component-level mounts, not full pages,
 *   so the lack of an outer landmark is expected.
 */

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import axe from "axe-core";
import { createRouter, createMemoryHistory } from "vue-router";
import AppHeader from "@/components/AppHeader.vue";
import FreeAgentView from "@/views/FreeAgentView.vue";
import WorkflowView from "@/views/WorkflowView.vue";

const memoryRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "free-agent", component: FreeAgentView },
    { path: "/workflow", name: "workflow", component: WorkflowView },
  ],
});

interface ScanResult {
  violations: Array<{ id: string; impact: string | null; nodes: unknown[]; description: string }>;
}

async function runAxeOnMount(component: unknown, opts: { withRouter?: boolean } = {}): Promise<ScanResult> {
  const wrapper = mount(component as never, opts.withRouter ? { global: { plugins: [memoryRouter] } } : undefined);
  // Attach to the document so axe can crawl it
  document.body.innerHTML = "";
  document.body.appendChild(wrapper.element);

  // jsdom doesn't expose a full <html lang>/<title> for component mounts.
  // Set them once so the page-level rules pass.
  if (!document.documentElement.hasAttribute("lang")) {
    document.documentElement.setAttribute("lang", "en-CA");
  }
  if (!document.title) {
    document.title = "ABC Agent Builder Console";
  }

  const results = await axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "landmark-one-main": { enabled: false },
      "page-has-heading-one": { enabled: false },
    },
  });

  wrapper.unmount();
  return results as ScanResult;
}

function failOnSeriousOrCritical(results: ScanResult, label: string): void {
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `  - [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} occurrences)`)
      .join("\n");
    throw new Error(`Accessibility violations in ${label}:\n${summary}`);
  }
}

describe("Accessibility (axe-core, WCAG 2.1 A+AA)", () => {
  it("AppHeader has no serious/critical violations", async () => {
    const results = await runAxeOnMount(AppHeader, { withRouter: true });
    expect(() => failOnSeriousOrCritical(results, "AppHeader")).not.toThrow();
  });

  it("FreeAgentView has no serious/critical violations", async () => {
    const results = await runAxeOnMount(FreeAgentView);
    expect(() => failOnSeriousOrCritical(results, "FreeAgentView")).not.toThrow();
  });

  it("WorkflowView has no serious/critical violations", async () => {
    const results = await runAxeOnMount(WorkflowView);
    expect(() => failOnSeriousOrCritical(results, "WorkflowView")).not.toThrow();
  });
});
