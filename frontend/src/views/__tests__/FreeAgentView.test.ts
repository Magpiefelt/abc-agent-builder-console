import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FreeAgentView from "../FreeAgentView.vue";

describe("FreeAgentView", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-session" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("renders the task input, model selector, and start button", () => {
    const wrapper = mount(FreeAgentView);
    expect(wrapper.find("textarea#prompt").exists()).toBe(true);
    expect(wrapper.find("select#model").exists()).toBe(true);
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("the prompt textarea is associated with a <label> via for=", () => {
    const wrapper = mount(FreeAgentView);
    const label = wrapper.find("label[for='prompt']");
    expect(label.exists()).toBe(true);
  });

  it("the model selector is associated with a <label> via for=", () => {
    const wrapper = mount(FreeAgentView);
    const label = wrapper.find("label[for='model']");
    expect(label.exists()).toBe(true);
  });

  it("disables Start Agent when prompt is empty", () => {
    const wrapper = mount(FreeAgentView);
    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("enables Start Agent after the user types a prompt", async () => {
    const wrapper = mount(FreeAgentView);
    const textarea = wrapper.find("textarea#prompt");
    await textarea.setValue("Find the population of Edmonton.");
    expect(wrapper.find("button").attributes("disabled")).toBeUndefined();
  });

  it("POSTs to /api/agent/sessions when Start Agent is clicked", async () => {
    const wrapper = mount(FreeAgentView);
    await wrapper.find("textarea#prompt").setValue("Find the population of Edmonton.");
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/agent/sessions",
      expect.objectContaining({ method: "POST" })
    );
  });
});
