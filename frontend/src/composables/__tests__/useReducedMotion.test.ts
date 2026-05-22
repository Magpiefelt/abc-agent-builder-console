/**
 * useReducedMotion composable tests.
 *
 * jsdom doesn't ship a real matchMedia, so each test installs a small
 * controllable shim that lets us flip `matches` and dispatch the `change`
 * event the same way a real browser would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useReducedMotion } from "../useReducedMotion";

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((e: MediaQueryListEvent) => void) | null;
  addEventListener: (
    type: string,
    listener: (e: MediaQueryListEvent) => void,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (e: MediaQueryListEvent) => void,
  ) => void;
  // Legacy Safari surface — intentionally typed because the composable
  // falls back to it when addEventListener is missing.
  addListener?: (listener: (e: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (e: MediaQueryListEvent) => void) => void;
}

function makeMatchMedia(initialMatches: boolean): {
  matchMedia: (q: string) => MockMediaQueryList;
  fire: (matches: boolean) => void;
  listeners: Array<(e: MediaQueryListEvent) => void>;
  removed: Array<(e: MediaQueryListEvent) => void>;
} {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const removed: Array<(e: MediaQueryListEvent) => void> = [];
  let mql: MockMediaQueryList | null = null;

  function matchMedia(query: string): MockMediaQueryList {
    mql = {
      matches: initialMatches,
      media: query,
      onchange: null,
      addEventListener(_type, listener) {
        listeners.push(listener);
      },
      removeEventListener(_type, listener) {
        removed.push(listener);
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      },
    };
    return mql;
  }

  function fire(matches: boolean): void {
    if (!mql) return;
    mql.matches = matches;
    const event = {
      matches,
      media: mql.media,
    } as unknown as MediaQueryListEvent;
    for (const listener of [...listeners]) listener(event);
  }

  return { matchMedia, fire, listeners, removed };
}

let originalMatchMedia: typeof window.matchMedia | undefined;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  if (originalMatchMedia) {
    window.matchMedia = originalMatchMedia;
  }
  vi.restoreAllMocks();
});

function buildHarness(): {
  mountAndRead: () => { value: boolean; unmount: () => void };
} {
  return {
    mountAndRead() {
      let snapshot = { value: false };
      const Comp = defineComponent({
        setup() {
          const reduced = useReducedMotion();
          return () => {
            snapshot = { value: reduced.value };
            return h("div", reduced.value ? "reduce" : "ok");
          };
        },
      });
      const wrapper = mount(Comp);
      return {
        get value() {
          return snapshot.value;
        },
        unmount: () => wrapper.unmount(),
      } as unknown as { value: boolean; unmount: () => void };
    },
  };
}

describe("useReducedMotion", () => {
  it("defaults to false when matchMedia is unavailable", () => {
    // Simulate a missing matchMedia (older jsdom / SSR).
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    const { mountAndRead } = buildHarness();
    const handle = mountAndRead();
    expect(handle.value).toBe(false);
    handle.unmount();
  });

  it("returns true when the media query matches on mount", () => {
    const { matchMedia } = makeMatchMedia(true);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { mountAndRead } = buildHarness();
    const handle = mountAndRead();
    expect(handle.value).toBe(true);
    handle.unmount();
  });

  it("returns false when the media query does not match on mount", () => {
    const { matchMedia } = makeMatchMedia(false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { mountAndRead } = buildHarness();
    const handle = mountAndRead();
    expect(handle.value).toBe(false);
    handle.unmount();
  });

  it("reactively updates when the user toggles the OS preference", async () => {
    const { matchMedia, fire } = makeMatchMedia(false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { mountAndRead } = buildHarness();
    const handle = mountAndRead();
    expect(handle.value).toBe(false);

    fire(true);
    await nextTick();
    expect(handle.value).toBe(true);

    fire(false);
    await nextTick();
    expect(handle.value).toBe(false);

    handle.unmount();
  });

  it("detaches the listener on unmount", () => {
    const { matchMedia, listeners, removed } = makeMatchMedia(false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { mountAndRead } = buildHarness();
    const handle = mountAndRead();
    expect(listeners.length).toBe(1);

    handle.unmount();
    expect(listeners.length).toBe(0);
    expect(removed.length).toBe(1);
  });

  it("falls back to addListener / removeListener on legacy Safari", () => {
    const legacyListeners: Array<(e: MediaQueryListEvent) => void> = [];
    const legacyRemoved: Array<(e: MediaQueryListEvent) => void> = [];

    function matchMedia(query: string): MockMediaQueryList {
      return {
        matches: true,
        media: query,
        onchange: null,
        // No addEventListener / removeEventListener — composable must fall
        // back to addListener / removeListener.
        addEventListener: undefined as unknown as MockMediaQueryList["addEventListener"],
        removeEventListener: undefined as unknown as MockMediaQueryList["removeEventListener"],
        addListener(listener) {
          legacyListeners.push(listener);
        },
        removeListener(listener) {
          legacyRemoved.push(listener);
        },
      };
    }
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { mountAndRead } = buildHarness();
    const handle = mountAndRead();
    expect(handle.value).toBe(true);
    expect(legacyListeners.length).toBe(1);

    handle.unmount();
    expect(legacyRemoved.length).toBe(1);
  });
});
