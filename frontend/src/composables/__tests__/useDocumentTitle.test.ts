import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useDocumentTitle } from "../useDocumentTitle";

describe("useDocumentTitle", () => {
  beforeEach(() => {
    document.title = "Agent Builder Console";
  });

  it("sets the document title with the base suffix on mount", () => {
    const Comp = defineComponent({
      setup() {
        useDocumentTitle(() => "Workflows");
        return () => h("div");
      },
    });
    mount(Comp);
    expect(document.title).toBe("Workflows · Agent Builder Console");
  });

  it("falls back to the base title when the value is empty", () => {
    const Comp = defineComponent({
      setup() {
        useDocumentTitle(() => "");
        return () => h("div");
      },
    });
    mount(Comp);
    expect(document.title).toBe("Agent Builder Console");
  });

  it("updates the title when a reactive source changes", async () => {
    const name = ref("Alpha");
    const Comp = defineComponent({
      setup() {
        useDocumentTitle(() => name.value);
        return () => h("div");
      },
    });
    mount(Comp);
    expect(document.title).toBe("Alpha · Agent Builder Console");
    name.value = "Beta";
    await nextTick();
    expect(document.title).toBe("Beta · Agent Builder Console");
  });

  it("restores the base title on unmount", () => {
    const Comp = defineComponent({
      setup() {
        useDocumentTitle(() => "Profile");
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    expect(document.title).toBe("Profile · Agent Builder Console");
    wrapper.unmount();
    expect(document.title).toBe("Agent Builder Console");
  });
});
