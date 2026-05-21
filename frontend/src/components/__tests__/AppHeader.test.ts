import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import AppHeader from "../AppHeader.vue";

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

function mountHeader(opts: { authenticated?: boolean } = {}): ReturnType<typeof mount> {
  const auth = useAuthStore();
  if (opts.authenticated) {
    auth.user = {
      id: "u-1",
      entraId: "entra-1",
      email: "cohen.mcleod@gov.ab.ca",
      displayName: "Cohen McLeod",
      ministryCode: "INFRA",
      role: "admin",
    };
  }
  return mount(AppHeader, { global: { plugins: [router] } });
}

describe("AppHeader — unauthenticated", () => {
  it("renders the GoA app header with the service name", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: false });
    const header = wrapper.find("goa-app-header");
    expect(header.exists()).toBe(true);
    expect(header.attributes("heading")).toBe("Agent Builder Console");
  });

  it("renders a Sign in link when the user is not signed in", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: false });
    expect(wrapper.text()).toContain("Sign in");
  });

  it("does not render primary nav links when unauthenticated", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: false });
    const navLinks = wrapper.findAll('a[slot="navigation"]');
    expect(navLinks).toHaveLength(0);
  });
});

describe("AppHeader — authenticated", () => {
  it("shows the user's display name and ministry badge", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: true });
    expect(wrapper.text()).toContain("Cohen McLeod");
    const badge = wrapper.find("goa-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.attributes("content")).toBe("INFRA");
  });

  it("renders Free Agent and Workflows nav links in the navigation slot", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: true });
    const navLinks = wrapper.findAll('a[slot="navigation"]');
    const labels = navLinks.map((l) => l.text());
    expect(labels).toContain("Free Agent");
    expect(labels).toContain("Workflows");
  });

  it("renders a Sign out button (GoA button)", async () => {
    const wrapper = mountHeader({ authenticated: true });
    const buttons = wrapper.findAll("goa-button");
    const signOut = buttons.find((b) => b.text().trim() === "Sign out");
    expect(signOut).toBeDefined();
  });
});
