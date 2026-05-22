/**
 * BlackboardViewer groups session blackboard entries by category, supports
 * text search across title/content/category, and supports category-chip
 * filtering. Entries render their content as markdown.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import BlackboardViewer from "../BlackboardViewer.vue";
import { useAgentSessionStore, type BlackboardEntry } from "@/stores/agentSession";

function entry(partial: Partial<BlackboardEntry> & Pick<BlackboardEntry, "category" | "title">): BlackboardEntry {
  return { content: "", iteration: 1, ...partial };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("BlackboardViewer", () => {
  it("shows an empty hint when the blackboard has no entries", () => {
    const wrapper = mount(BlackboardViewer);
    expect(wrapper.text()).toContain("The agent hasn't written to the blackboard yet");
  });

  it("groups entries by category, sorted alphabetically", () => {
    const store = useAgentSessionStore();
    store.blackboard = [
      entry({ category: "research", title: "A" }),
      entry({ category: "decisions", title: "B" }),
      entry({ category: "research", title: "C" }),
    ];

    const wrapper = mount(BlackboardViewer);
    const headings = wrapper.findAll("h4").map((h) => h.text());
    expect(headings).toEqual(["decisions", "research"]);
    expect(wrapper.findAll("li").length).toBe(3);
  });

  it("renders each entry's iteration as a badge", () => {
    const store = useAgentSessionStore();
    store.blackboard = [
      entry({ category: "x", title: "T1", iteration: 4 }),
      entry({ category: "x", title: "T2", iteration: 7 }),
    ];

    const wrapper = mount(BlackboardViewer);
    expect(wrapper.find('goa-badge[content="#4"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[content="#7"]').exists()).toBe(true);
  });

  it("renders entry content through the markdown renderer", () => {
    const store = useAgentSessionStore();
    store.blackboard = [
      entry({ category: "x", title: "T", content: "# Heading\n\nBody **bold**." }),
    ];

    const wrapper = mount(BlackboardViewer);
    const html = wrapper.html();
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("filters by search term across title, content, and category", async () => {
    const store = useAgentSessionStore();
    store.blackboard = [
      entry({ category: "decisions", title: "Choose framework", content: "Vue 3" }),
      entry({ category: "research", title: "Vendor list", content: "Acme Corp" }),
      entry({ category: "questions", title: "Open items", content: "Q1" }),
    ];

    const wrapper = mount(BlackboardViewer);
    wrapper.find('goa-input[name="bb-search"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "acme" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("li").length).toBe(1);
    expect(wrapper.text()).toContain("Vendor list");
    expect(wrapper.text()).not.toContain("Choose framework");
  });

  it("filters by category chip and combines with search", async () => {
    const store = useAgentSessionStore();
    store.blackboard = [
      entry({ category: "decisions", title: "DA" }),
      entry({ category: "decisions", title: "DB" }),
      entry({ category: "research", title: "RA" }),
    ];

    const wrapper = mount(BlackboardViewer);
    const decisionsChip = wrapper.find('goa-filter-chip[content="decisions"]');
    expect(decisionsChip.exists()).toBe(true);
    decisionsChip.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("li").length).toBe(2);
    expect(wrapper.text()).toContain("DA");
    expect(wrapper.text()).not.toContain("RA");

    // Toggling the same chip clears the filter.
    decisionsChip.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("li").length).toBe(3);
  });

  it("shows the no-match panel and Clear-filters button when nothing matches", async () => {
    const store = useAgentSessionStore();
    store.blackboard = [entry({ category: "x", title: "Anything", content: "no match" })];

    const wrapper = mount(BlackboardViewer);
    wrapper.find('goa-input[name="bb-search"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "zzz" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("No entries match your filters");
    const clear = wrapper.find("button");
    expect(clear.text()).toContain("Clear filters");

    await clear.trigger("click");
    expect(wrapper.findAll("li").length).toBe(1);
  });

  it("treats search as case-insensitive", async () => {
    const store = useAgentSessionStore();
    store.blackboard = [
      entry({ category: "x", title: "Mixed Case Title", content: "Body" }),
    ];

    const wrapper = mount(BlackboardViewer);
    wrapper.find('goa-input[name="bb-search"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "MIXED" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll("li").length).toBe(1);
  });
});
