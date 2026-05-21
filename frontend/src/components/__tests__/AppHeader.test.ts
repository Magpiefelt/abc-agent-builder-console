import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AppHeader from "../AppHeader.vue";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "free-agent", component: { template: "<div>home</div>" } },
    { path: "/workflow", name: "workflow", component: { template: "<div>wf</div>" } },
  ],
});

describe("AppHeader", () => {
  it("renders the app title", async () => {
    await router.push("/");
    const wrapper = mount(AppHeader, { global: { plugins: [router] } });
    expect(wrapper.text()).toContain("Agent Builder Console");
  });

  it("renders navigation links to / and /workflow", async () => {
    await router.push("/");
    const wrapper = mount(AppHeader, { global: { plugins: [router] } });
    const html = wrapper.html();
    expect(html).toMatch(/Free Agent/i);
    expect(html).toMatch(/Workflow/i);
  });

  it("renders the placeholder user info", async () => {
    const wrapper = mount(AppHeader, { global: { plugins: [router] } });
    expect(wrapper.text()).toContain("Cohen McLeod");
  });

  it("renders a header element (semantic landmark)", async () => {
    const wrapper = mount(AppHeader, { global: { plugins: [router] } });
    expect(wrapper.find("header").exists()).toBe(true);
  });
});
