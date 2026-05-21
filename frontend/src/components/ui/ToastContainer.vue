<script setup lang="ts">
import { useToast, type Toast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function notificationType(kind: Toast['kind']): 'emergency' | 'important' | 'event' | 'information' {
  switch (kind) {
    case 'error':
      return 'emergency'
    case 'warning':
      return 'important'
    case 'success':
      return 'event'
    default:
      return 'information'
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
      class="pointer-events-auto"
      role="status"
    >
      <goa-notification
        :type="notificationType(t.kind)"
        @_dismiss="dismiss(t.id)"
        @_close="dismiss(t.id)"
      >
        {{ t.message }}
      </goa-notification>
    </div>
  </div>
</template>
