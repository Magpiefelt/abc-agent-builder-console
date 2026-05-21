<script setup lang="ts">
import { useToast, type Toast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function kindStyles(kind: Toast['kind']): { bg: string; border: string; text: string; label: string } {
  switch (kind) {
    case 'error':
      return {
        bg: 'bg-white',
        border: 'border-[var(--goa-color-error)]',
        text: 'text-[var(--goa-color-error)]',
        label: 'Error',
      }
    case 'warning':
      return {
        bg: 'bg-white',
        border: 'border-[var(--goa-color-warning)]',
        text: 'text-[var(--goa-color-text)]',
        label: 'Warning',
      }
    case 'success':
      return {
        bg: 'bg-white',
        border: 'border-[var(--goa-color-success)]',
        text: 'text-[var(--goa-color-success)]',
        label: 'Success',
      }
    default:
      return {
        bg: 'bg-white',
        border: 'border-[var(--goa-color-info)]',
        text: 'text-[var(--goa-color-text)]',
        label: 'Info',
      }
  }
}
</script>

<template>
  <div
    aria-live="polite"
    aria-atomic="true"
    class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-96 pointer-events-none"
  >
    <div
      v-for="t in toasts"
      :key="t.id"
      :class="[
        'pointer-events-auto rounded-md border-l-4 shadow-md p-3 flex items-start gap-3',
        kindStyles(t.kind).bg,
        kindStyles(t.kind).border,
      ]"
      role="status"
    >
      <div class="flex-1 min-w-0">
        <div :class="['text-xs font-semibold uppercase tracking-wide mb-1', kindStyles(t.kind).text]">
          {{ kindStyles(t.kind).label }}
        </div>
        <div class="text-sm text-[var(--goa-color-text)] break-words">{{ t.message }}</div>
      </div>
      <button
        type="button"
        @click="dismiss(t.id)"
        aria-label="Dismiss notification"
        class="shrink-0 text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded p-1"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" fill="none" />
        </svg>
      </button>
    </div>
  </div>
</template>
