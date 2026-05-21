import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useCounterStore } from "../counter";

describe("useCounterStore (framework smoke)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts at 0", () => {
    const store = useCounterStore();
    expect(store.count).toBe(0);
  });

  it("doubleCount is reactive to count", () => {
    const store = useCounterStore();
    store.count = 3;
    expect(store.doubleCount).toBe(6);
  });

  it("increment() raises count by 1", () => {
    const store = useCounterStore();
    store.increment();
    store.increment();
    expect(store.count).toBe(2);
  });
});
