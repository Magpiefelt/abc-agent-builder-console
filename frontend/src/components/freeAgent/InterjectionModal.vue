<script setup lang="ts">
import { ref } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'
import { useFocusTrap } from '@/composables/useFocusTrap'

const emit = defineEmits<{ close: [] }>()

const session = useAgentSessionStore()

const message = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const dialogRef = ref<HTMLDivElement | null>(null)

useFocusTrap(dialogRef, {
  onEscape: () => emit('close'),
  initialFocus: () => textareaRef.value,
})

async function handleSubmit(): Promise<void> {
  if (!message.value.trim()) return
  await session.interject(message.value.trim())
  emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="interject-title"
  >
    <div
      ref="dialogRef"
      tabindex="-1"
      class="w-full sm:max-w-md bg-[var(--goa-color-surface)] rounded-md shadow-lg border border-[var(--goa-color-border)] flex flex-col focus:outline-none"
    >
      <header class="flex items-center justify-between px-4 py-3 border-b border-[var(--goa-color-border)]">
        <h3 id="interject-title" class="text-base font-semibold text-[var(--goa-color-primary-dark)]">
          Send Guidance
        </h3>
        <button
          type="button"
          @click="emit('close')"
          aria-label="Close"
          class="text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded p-1"
        >
          <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" fill="none" />
          </svg>
        </button>
      </header>
      <div class="p-4 flex flex-col gap-3">
        <label for="interject-msg" class="text-sm font-medium">
          Your message will be injected into the next iteration.
        </label>
        <textarea
          id="interject-msg"
          ref="textareaRef"
          v-model="message"
          rows="4"
          placeholder="e.g. Focus on the financial impact section."
          class="w-full p-3 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        />
      </div>
      <footer class="flex justify-end gap-2 px-4 py-3 border-t border-[var(--goa-color-border)]">
        <button
          type="button"
          @click="emit('close')"
          class="px-3 py-1.5 text-sm border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleSubmit"
          :disabled="!message.trim()"
          class="px-3 py-1.5 text-sm bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Send
        </button>
      </footer>
    </div>
  </div>
</template>
