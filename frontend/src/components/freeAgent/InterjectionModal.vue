<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'

const emit = defineEmits<{ close: [] }>()

const session = useAgentSessionStore()

const message = ref('')
const submitting = ref(false)

async function handleSubmit(): Promise<void> {
  if (submitting.value || !message.value.trim()) return
  submitting.value = true
  try {
    await session.interject(message.value.trim())
    emit('close')
  } finally {
    submitting.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  // Cmd/Ctrl+Enter — submit. Esc handled by goa-modal.
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void handleSubmit()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <goa-modal
    open
    heading="Send Guidance"
    role="dialog"
    @_close="emit('close')"
  >
    <goa-form-item label="Your message will be injected into the next iteration.">
      <goa-textarea
        name="interject-msg"
        :value="message"
        rows="4"
        placeholder="e.g. Focus on the financial impact section."
        @_change="(e: CustomEvent<{ value: string }>) => (message = e.detail.value)"
      ></goa-textarea>
    </goa-form-item>

    <div slot="actions" class="flex items-center justify-between gap-2 w-full">
      <span class="text-xs text-[var(--goa-color-text-secondary)] hidden sm:inline">
        Tip: ⌘/Ctrl+Enter to send.
      </span>
      <div class="flex gap-2 ml-auto">
        <goa-button
          type="secondary"
          :disabled="submitting || undefined"
          @_click="emit('close')"
        >
          Cancel
        </goa-button>
        <goa-button
          type="primary"
          :disabled="!message.trim() || submitting || undefined"
          @_click="handleSubmit"
        >
          {{ submitting ? 'Sending…' : 'Send' }}
        </goa-button>
      </div>
    </div>
  </goa-modal>
</template>
