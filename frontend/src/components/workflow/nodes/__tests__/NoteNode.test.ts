/**
 * NoteNode renders a sticky-note style node card. No Vue Flow handles — notes
 * are anchored but not connected.
 */

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import NoteNode from "../NoteNode.vue";
import type { NoteNodeData } from "@/types/workflow";

function dataFor(partial: Partial<NoteNodeData> = {}): NoteNodeData {
  return { kind: "note", label: "", markdown: "", ...partial };
}

describe("NoteNode", () => {
  it("renders the label when present, otherwise 'Note'", () => {
    const labeled = mount(NoteNode, {
      props: { id: "n1", data: dataFor({ label: "Reminder" }) },
    });
    expect(labeled.text()).toContain("Reminder");

    const unlabeled = mount(NoteNode, {
      props: { id: "n2", data: dataFor() },
    });
    expect(unlabeled.text()).toContain("Note");
  });

  it("renders markdown body content as plain text when present", () => {
    const wrapper = mount(NoteNode, {
      props: {
        id: "n1",
        data: dataFor({ markdown: "Multi\nline\nbody" }),
      },
    });
    expect(wrapper.text()).toContain("Multi");
    expect(wrapper.text()).toContain("line");
    expect(wrapper.text()).toContain("body");
  });

  it("renders a placeholder when markdown body is empty", () => {
    const wrapper = mount(NoteNode, {
      props: { id: "n1", data: dataFor() },
    });
    expect(wrapper.text()).toContain("Add notes here…");
  });

  it("highlights the border when selected", () => {
    const selected = mount(NoteNode, {
      props: { id: "n1", data: dataFor(), selected: true },
    });
    expect(selected.html()).toContain("border-[var(--goa-color-primary)]");

    const unselected = mount(NoteNode, {
      props: { id: "n2", data: dataFor(), selected: false },
    });
    expect(unselected.html()).toContain("border-[var(--goa-color-warning)]");
  });
});
