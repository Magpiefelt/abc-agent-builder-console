/**
 * ScratchpadViewer renders the session scratchpad as sanitized markdown and
 * lists the session attributes as a definition list.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import ScratchpadViewer from "../ScratchpadViewer.vue";
import { useAgentSessionStore } from "@/stores/agentSession";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("ScratchpadViewer", () => {
  it("renders empty hints when both scratchpad and attributes are empty", () => {
    const wrapper = mount(ScratchpadViewer);
    expect(wrapper.text()).toContain("No scratchpad notes yet");
    expect(wrapper.text()).toContain("No attributes set");
  });

  it("renders scratchpad markdown through the renderer", () => {
    const store = useAgentSessionStore();
    store.scratchpad = "# Plan\n\n- item one\n- item two";

    const wrapper = mount(ScratchpadViewer);
    const html = wrapper.html();
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain("<li>item one</li>");
    expect(wrapper.text()).not.toContain("No scratchpad notes yet");
  });

  it("renders attribute entries with string values verbatim", () => {
    const store = useAgentSessionStore();
    store.attributes = { tone: "formal", audience: "minister" };

    const wrapper = mount(ScratchpadViewer);
    const text = wrapper.text();
    expect(text).toContain("tone");
    expect(text).toContain("formal");
    expect(text).toContain("audience");
    expect(text).toContain("minister");
    expect(text).not.toContain("No attributes set");
  });

  it("JSON-stringifies non-string attribute values", () => {
    const store = useAgentSessionStore();
    store.attributes = {
      counts: { drafts: 3, finals: 1 },
      ready: true,
      tags: ["policy", "draft"],
    };

    const wrapper = mount(ScratchpadViewer);
    const text = wrapper.text();
    // JSON.stringify without indent — no spaces after colons.
    expect(text).toContain('{"drafts":3,"finals":1}');
    expect(text).toContain("true");
    expect(text).toContain('["policy","draft"]');
  });

  it("sanitizes dangerous HTML in the scratchpad", () => {
    const store = useAgentSessionStore();
    store.scratchpad = '<script>window.__pwned = 1</script>\n\nSafe paragraph.';

    const wrapper = mount(ScratchpadViewer);
    // DOMPurify in renderMarkdown should strip the inline script tag.
    expect(wrapper.html()).not.toContain("<script>window.__pwned");
    expect(wrapper.text()).toContain("Safe paragraph");
  });
});
