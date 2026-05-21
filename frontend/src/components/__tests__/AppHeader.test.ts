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
  it("renders the app title and a Sign in link", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: false });
    expect(wrapper.text()).toContain("Agent Builder Console");
    expect(wrapper.text()).toContain("Sign in");
  });

  it("does not show the primary nav when the user is not signed in", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: false });
    const navs = wrapper.findAll('nav[aria-label="Primary navigation"]');
    expect(navs).toHaveLength(0);
  });

  it("renders a banner landmark", async () => {
    const wrapper = mountHeader({ authenticated: false });
    expect(wrapper.find('header[role="banner"]').exists()).toBe(true);
  });
});

describe("AppHeader — authenticated", () => {
  it("shows the user's display name and ministry chip", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: true });
    expect(wrapper.text()).toContain("Cohen McLeod");
    expect(wrapper.text()).toContain("INFRA");
  });

  it("renders Free Agent and Workflows nav links with focus rings", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: true });
    const nav = wrapper.find('nav[aria-label="Primary navigation"]');
    expect(nav.exists()).toBe(true);
    expect(nav.html()).toMatch(/Free Agent/i);
    expect(nav.html()).toMatch(/Workflows/i);
    expect(nav.html()).toMatch(/focus-visible:ring/);
  });

  it("renders the Sign out button with an aria-label", async () => {
    const wrapper = mountHeader({ authenticated: true });
    const signOut = wrapper.find('button[aria-label*="Sign out"]');
    expect(signOut.exists()).toBe(true);
  });
});
