<script setup lang="ts">
import { ref } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'

const emit = defineEmits<{ close: [] }>()

const session = useAgentSessionStore()

const message = ref('')

async function handleSubmit(): Promise<void> {
  if (!message.value.trim()) return
  await session.interject(message.value.trim())
  emit('close')
}
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

    <div slot="actions" class="flex justify-end gap-2">
      <goa-button type="secondary" @_click="emit('close')">Cancel</goa-button>
      <goa-button
        type="primary"
        :disabled="!message.trim() || undefined"
        @_click="handleSubmit"
      >
        Send
      </goa-button>
    </div>
  </goa-modal>
</template>
