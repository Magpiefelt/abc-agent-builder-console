/**
 * Accessibility audit using axe-core under jsdom.
 *
 * For each top-level view, mount the component (with Pinia + memoryRouter
 * installed and heavy child components stubbed so jsdom can render them in
 * isolation), attach the DOM to the document, and run axe.run() with the
 * WCAG 2.1 A + AA tagged ruleset.
 *
 * Fails on any violation with impact: "serious" | "critical".
 *
 * jsdom limitations:
 * - color-contrast — jsdom can't compute styles reliably; deferred to manual
 *   browser audit (documented in docs/quality/accessibility_audit.md).
 * - region / landmark-one-main / page-has-heading-one — page-level rules
 *   don't apply to component-level mounts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import axe from "axe-core";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import AppHeader from "@/components/AppHeader.vue";
import FreeAgentView from "@/views/FreeAgentView.vue";

const heavyChildStubs = {
  TaskPanel: true,
  ControlBar: true,
  IterationTimeline: true,
  BlackboardViewer: true,
  ScratchpadViewer: true,
  ArtifactsPanel: true,
  AgentCanvas: true,
  FinalReportPanel: true,
  // Workflow view's children
  WorkflowToolbar: true,
  WorkflowSidebar: true,
  WorkflowCanvas: true,
  PropertiesPanel: true,
};

let router: Router;

beforeEach(() => {
  setActivePinia(createPinia());
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "free-agent", component: { template: "<div>home</div>" } },
      { path: "/workflows", name: "workflow", component: { template: "<div>wf</div>" } },
      { path: "/profile", name: "profile", component: { template: "<div>profile</div>" } },
      { path: "/login", name: "login", component: { template: "<div>login</div>" } },
    ],
  });
});

interface ScanResult {
  violations: Array<{ id: string; impact: string | null; nodes: unknown[]; description: string }>;
}

async function runAxeOnMount(component: unknown, opts: { withRouter?: boolean } = {}): Promise<ScanResult> {
  const wrapper = mount(component as never, {
    global: {
      plugins: opts.withRouter ? [router] : [],
      stubs: heavyChildStubs,
    },
  });

  if (!document.documentElement.hasAttribute("lang")) {
    document.documentElement.setAttribute("lang", "en-CA");
  }
  if (!document.title) {
    document.title = "ABC Agent Builder Console";
  }

  document.body.innerHTML = "";
  document.body.appendChild(wrapper.element);

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
  it("AppHeader (unauthenticated) has no serious/critical violations", async () => {
    const results = await runAxeOnMount(AppHeader, { withRouter: true });
    expect(() => failOnSeriousOrCritical(results, "AppHeader (unauthenticated)")).not.toThrow();
  });

  it("FreeAgentView has no serious/critical violations", async () => {
    const results = await runAxeOnMount(FreeAgentView);
    expect(() => failOnSeriousOrCritical(results, "FreeAgentView")).not.toThrow();
  });
});
