import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToast } from "../useToast";

describe("useToast", () => {
  beforeEach(() => {
    // Drain any toasts left from previous tests
    const { toasts, dismiss } = useToast();
    for (const t of [...toasts.value]) dismiss(t.id);
    vi.useFakeTimers();
  });

  it("push() appends a toast and returns an id", () => {
    const { push, toasts } = useToast();
    const id = push({ message: "hello" });
    expect(toasts.value.find((t) => t.id === id)).toBeDefined();
    expect(toasts.value.find((t) => t.id === id)?.kind).toBe("info");
  });

  it("dismiss() removes a toast by id", () => {
    const { push, dismiss, toasts } = useToast();
    const id = push({ message: "removable" });
    dismiss(id);
    expect(toasts.value.find((t) => t.id === id)).toBeUndefined();
  });

  it("auto-dismisses after ttlMs", () => {
    const { push, toasts } = useToast();
    const id = push({ message: "self-expiring", ttlMs: 500 });
    expect(toasts.value.find((t) => t.id === id)).toBeDefined();
    vi.advanceTimersByTime(600);
    expect(toasts.value.find((t) => t.id === id)).toBeUndefined();
  });

  it("does NOT auto-dismiss when ttlMs is 0", () => {
    const { push, toasts } = useToast();
    const id = push({ message: "sticky", ttlMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(toasts.value.find((t) => t.id === id)).toBeDefined();
  });

  it("respects the kind parameter", () => {
    const { push, toasts } = useToast();
    const id = push({ kind: "error", message: "boom" });
    expect(toasts.value.find((t) => t.id === id)?.kind).toBe("error");
  });
});
