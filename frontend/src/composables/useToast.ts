/**
 * Lightweight global toast queue.
 *
 * One module-level reactive list; any component (typically ToastContainer.vue
 * mounted in App.vue) can render it. Auto-dismiss after ttlMs.
 */

import { ref } from 'vue'

export type ToastKind = 'info' | 'warning' | 'error' | 'success'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  ttlMs: number
}

const toasts = ref<Toast[]>([])
let nextId = 1

function push(input: { kind?: ToastKind; message: string; ttlMs?: number }): number {
  const id = nextId++
  const toast: Toast = {
    id,
    kind: input.kind ?? 'info',
    message: input.message,
    ttlMs: input.ttlMs ?? 5000,
  }
  toasts.value = [...toasts.value, toast]
  if (toast.ttlMs > 0) {
    setTimeout(() => dismiss(id), toast.ttlMs)
  }
  return id
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

export function useToast() {
  return { toasts, push, dismiss }
}
