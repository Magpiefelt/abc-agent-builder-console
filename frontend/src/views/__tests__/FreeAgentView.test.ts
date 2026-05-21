/**
 * After Stream B landed the SSE-consuming Free Agent UI, the view became a
 * thin composition shell over many child components (TaskPanel, ControlBar,
 * IterationTimeline, BlackboardViewer, ScratchpadViewer, ArtifactsPanel,
 * AgentCanvas, FinalReportPanel). The previous interaction tests against the
 * raw textarea + button are obsolete because the form moved into TaskPanel.
 *
 * These tests verify the layout structure (landmarks + tablist) rather than
 * the form fields, which are owned by TaskPanel and its own tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import FreeAgentView from "../FreeAgentView.vue";

beforeEach(() => {
  setActivePinia(createPinia());
});

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "free-agent", component: { template: "<div />" } },
      {
        path: "/sessions/:id",
        name: "session-replay",
        component: { template: "<div />" },
      },
    ],
  });
}

function mountView() {
  return mount(FreeAgentView, {
    global: {
      plugins: [makeRouter()],
      stubs: {
        TaskPanel: true,
        ControlBar: true,
        IterationTimeline: true,
        BlackboardViewer: true,
        ScratchpadViewer: true,
        ArtifactsPanel: true,
        AgentCanvas: true,
        FinalReportPanel: true,
      },
    },
  });
}

describe("FreeAgentView — layout shell", () => {
  it("renders without crashing under jsdom", () => {
    expect(mountView().exists()).toBe(true);
  });

  it("renders the task configuration aside (desktop layout)", () => {
    expect(mountView().find('aside[aria-label="Task configuration"]').exists()).toBe(true);
  });

  it("renders the agent memory viewer aside with a memory tablist", () => {
    const wrapper = mountView();
    expect(wrapper.find('aside[aria-label="Agent memory viewer"]').exists()).toBe(true);
    expect(wrapper.find("goa-tabs").exists()).toBe(true);
    expect(wrapper.findAll("goa-tab").length).toBe(3);
  });

  it("renders the agent execution canvas section as a landmark", () => {
    expect(mountView().find('section[aria-label="Agent execution canvas"]').exists()).toBe(true);
  });
});
