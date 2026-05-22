/**
 * ArtifactsPanel renders one card per session artifact, supports type filter
 * chips, and tags artifacts as persisted vs transient based on the presence
 * of an id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import ArtifactsPanel from "../ArtifactsPanel.vue";
import { useAgentSessionStore, type ArtifactRecord } from "@/stores/agentSession";

function art(partial: Partial<ArtifactRecord> & Pick<ArtifactRecord, "type" | "title">): ArtifactRecord {
  return {
    id: "art-1",
    mimeType: null,
    description: null,
    iteration: 1,
    size: 1024,
    ...partial,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("ArtifactsPanel", () => {
  it("shows the empty hint when no artifacts have been produced", () => {
    const wrapper = mount(ArtifactsPanel);
    expect(wrapper.text()).toContain("No artifacts yet");
  });

  it("renders all known artifact types as filter chips", () => {
    const wrapper = mount(ArtifactsPanel);
    const labels = wrapper.findAll("goa-button").map((b) => b.text().trim());
    expect(labels).toEqual(["Text", "File", "Image", "Audio", "Data"]);
  });

  it("renders one card per artifact and shows mime type + size + iteration", () => {
    const store = useAgentSessionStore();
    store.artifacts = [
      art({ id: "a", title: "Draft", type: "text", mimeType: "text/markdown", iteration: 2, size: 2048 }),
      art({ id: "b", title: "Logo", type: "image", mimeType: "image/png", iteration: 3, size: 5_000_000 }),
    ];

    const wrapper = mount(ArtifactsPanel);
    const cards = wrapper.findAll("article");
    expect(cards.length).toBe(2);
    const html = wrapper.text();
    expect(html).toContain("Draft");
    expect(html).toContain("text/markdown");
    expect(html).toContain("2.0 KB");
    expect(html).toContain("iter #2");
    expect(html).toContain("Logo");
    expect(html).toContain("image/png");
    expect(html).toContain("4.77 MB");
    expect(html).toContain("iter #3");
  });

  it("tags artifacts as Persisted when they have an id, Transient otherwise", () => {
    const store = useAgentSessionStore();
    store.artifacts = [
      art({ id: "a", title: "Saved", type: "text" }),
      art({ id: null, title: "InMem", type: "text" }),
    ];

    const wrapper = mount(ArtifactsPanel);
    expect(wrapper.find('goa-badge[content="Persisted"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[content="Transient"]').exists()).toBe(true);
  });

  it("filters by a single type chip", async () => {
    const store = useAgentSessionStore();
    store.artifacts = [
      art({ id: "a", title: "X", type: "text" }),
      art({ id: "b", title: "Y", type: "image" }),
      art({ id: "c", title: "Z", type: "image" }),
    ];

    const wrapper = mount(ArtifactsPanel);
    const imageBtn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Image");
    imageBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("article").length).toBe(2);
    expect(wrapper.text()).not.toContain("X");
    expect(wrapper.text()).toContain("Y");
    expect(wrapper.text()).toContain("Z");
  });

  it("combines two chips with an OR", async () => {
    const store = useAgentSessionStore();
    store.artifacts = [
      art({ id: "a", title: "Doc", type: "text" }),
      art({ id: "b", title: "Pic", type: "image" }),
      art({ id: "c", title: "Sound", type: "audio" }),
    ];

    const wrapper = mount(ArtifactsPanel);
    const buttons = wrapper.findAll("goa-button");
    const image = buttons.find((b) => b.text().trim() === "Image")!;
    const audio = buttons.find((b) => b.text().trim() === "Audio")!;
    image.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    audio.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("article").length).toBe(2);
    expect(wrapper.text()).toContain("Pic");
    expect(wrapper.text()).toContain("Sound");
    expect(wrapper.text()).not.toContain("Doc");
  });

  it("shows the no-match hint + clear filters when chips exclude every artifact", async () => {
    const store = useAgentSessionStore();
    store.artifacts = [art({ id: "a", title: "Only text", type: "text" })];

    const wrapper = mount(ArtifactsPanel);
    const imageBtn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Image");
    imageBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("No artifacts match");
    expect(wrapper.find("button").text()).toContain("Clear filters");

    await wrapper.find("button").trigger("click");
    expect(wrapper.findAll("article").length).toBe(1);
  });

  it("formats sizes in bytes / KB / MB", () => {
    const store = useAgentSessionStore();
    store.artifacts = [
      art({ id: "a", title: "tiny", type: "text", size: 512 }),
      art({ id: "b", title: "kb", type: "text", size: 4096 }),
      art({ id: "c", title: "mb", type: "text", size: 3 * 1024 * 1024 }),
    ];

    const wrapper = mount(ArtifactsPanel);
    const text = wrapper.text();
    expect(text).toContain("512 B");
    expect(text).toContain("4.0 KB");
    expect(text).toContain("3.00 MB");
  });
});
