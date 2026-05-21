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
import FreeAgentView from "../FreeAgentView.vue";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("FreeAgentView — layout shell", () => {
  it("renders without crashing under jsdom", () => {
    const wrapper = mount(FreeAgentView, {
      global: {
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
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the task configuration aside (desktop layout)", () => {
    const wrapper = mount(FreeAgentView, {
      global: {
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
    expect(wrapper.find('aside[aria-label="Task configuration"]').exists()).toBe(true);
  });

  it("renders the agent memory viewer aside with a memory tablist", () => {
    const wrapper = mount(FreeAgentView, {
      global: {
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
    expect(wrapper.find('aside[aria-label="Agent memory viewer"]').exists()).toBe(true);
    expect(wrapper.find("goa-tabs").exists()).toBe(true);
    expect(wrapper.findAll("goa-tab").length).toBe(3);
  });

  it("renders the agent execution canvas section as a landmark", () => {
    const wrapper = mount(FreeAgentView, {
      global: {
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
    expect(wrapper.find('section[aria-label="Agent execution canvas"]').exists()).toBe(true);
  });
});
