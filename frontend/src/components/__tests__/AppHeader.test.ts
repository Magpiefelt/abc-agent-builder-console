import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import AppHeader from "../AppHeader.vue";
import { __resetThemeForTests, useTheme } from "@/composables/useTheme";

let router: Router;

beforeEach(() => {
  setActivePinia(createPinia());
  // Theme is module-singleton state. Reset between specs so one test's cycle
  // call doesn't leak into the next test's preference assertion.
  __resetThemeForTests();
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "free-agent", component: { template: "<div>home</div>" } },
      { path: "/workflows", name: "workflow", component: { template: "<div>wf</div>" } },
      { path: "/sessions", name: "session-history", component: { template: "<div>history</div>" } },
      { path: "/profile", name: "profile", component: { template: "<div>profile</div>" } },
      { path: "/login", name: "login", component: { template: "<div>login</div>" } },
      { path: "/admin", name: "admin", component: { template: "<div>admin</div>" } },
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

  it("renders Free Agent, Workflows, and Sessions nav links in the navigation slot", async () => {
    await router.push("/");
    const wrapper = mountHeader({ authenticated: true });
    const navLinks = wrapper.findAll('a[slot="navigation"]');
    const labels = navLinks.map((l) => l.text());
    expect(labels).toContain("Free Agent");
    expect(labels).toContain("Workflows");
    expect(labels).toContain("Sessions");
  });

  it("renders a Sign out button (GoA button)", async () => {
    const wrapper = mountHeader({ authenticated: true });
    const buttons = wrapper.findAll("goa-button");
    const signOut = buttons.find((b) => b.text().trim() === "Sign out");
    expect(signOut).toBeDefined();
  });
});

describe("AppHeader — theme toggle", () => {
  it("renders the theme toggle button for unauthenticated users", () => {
    const wrapper = mountHeader({ authenticated: false });
    const toggle = wrapper.find('[data-testid="theme-toggle"]');
    expect(toggle.exists()).toBe(true);
  });

  it("renders the theme toggle button for authenticated users", () => {
    const wrapper = mountHeader({ authenticated: true });
    const toggle = wrapper.find('[data-testid="theme-toggle"]');
    expect(toggle.exists()).toBe(true);
  });

  it("announces the next action it will take in aria-label", async () => {
    // Default preference is 'system' after the reset hook fires. The toggle
    // is a real <button> (not a custom element) so axe's aria-prohibited-attr
    // rule is satisfied and the accessible name lands in `aria-label`.
    const wrapper = mountHeader({ authenticated: true });
    const toggle = wrapper.find('[data-testid="theme-toggle"]');
    expect(toggle.attributes("aria-label")).toMatch(/light/i);
  });

  it("cycles the theme preference when clicked", async () => {
    const wrapper = mountHeader({ authenticated: true });
    const toggle = wrapper.find('[data-testid="theme-toggle"]');
    const theme = useTheme();
    // Start from a known preference so the test is deterministic regardless
    // of system prefers-color-scheme.
    theme.setTheme("light");
    await wrapper.vm.$nextTick();
    await toggle.trigger("click");
    expect(theme.preference.value).toBe("dark");
    await toggle.trigger("click");
    expect(theme.preference.value).toBe("system");
    await toggle.trigger("click");
    expect(theme.preference.value).toBe("light");
  });
});
