<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'
import InterjectionModal from './InterjectionModal.vue'

const session = useAgentSessionStore()

const interjectOpen = ref(false)
const continueOpen = ref(false)
const continuePrompt = ref('')
const continueAdditional = ref<number | null>(null)

const statusLabel = computed(() => {
  switch (session.status) {
    case 'idle':
      return 'Idle'
    case 'creating':
      return 'Creating…'
    case 'running':
      return 'Running'
    case 'paused':
      return 'Paused'
    case 'completed':
      return 'Completed'
    case 'error':
      return 'Error'
    case 'needs_assistance':
      return 'Needs assistance'
  }
  return 'Unknown'
})

const statusColor = computed(() => {
  switch (session.status) {
    case 'running':
      return 'bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]'
    case 'paused':
      return 'bg-yellow-100 text-yellow-900'
    case 'completed':
      return 'bg-green-100 text-[var(--goa-color-success)]'
    case 'error':
      return 'bg-red-100 text-[var(--goa-color-error)]'
    case 'needs_assistance':
      return 'bg-orange-100 text-orange-900'
    default:
      return 'bg-gray-100 text-[var(--goa-color-text-secondary)]'
  }
})

const iterationDisplay = computed(() => {
  const max = session.sessionMeta?.maxIterations ?? 0
  if (!max) return session.currentIteration > 0 ? String(session.currentIteration) : '—'
  return `${session.currentIteration} / ${max}`
})

async function handleStop(): Promise<void> {
  await session.stop()
}

function openContinue(): void {
  continuePrompt.value = ''
  continueAdditional.value = null
  continueOpen.value = true
}

async function submitContinue(): Promise<void> {
  if (!continuePrompt.value.trim()) return
  await session.continueSession(
    continuePrompt.value.trim(),
    continueAdditional.value ?? undefined,
  )
  continueOpen.value = false
}
</script>

<template>
  <div
    class="bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]"
    role="region"
    aria-label="Session controls"
  >
    <div class="flex flex-wrap items-center gap-3 px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Status</span>
        <span
          aria-live="polite"
          :class="['px-2.5 py-1 rounded-full text-xs font-semibold', statusColor]"
        >
          {{ statusLabel }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Iteration</span>
        <span class="text-sm font-medium">{{ iterationDisplay }}</span>
      </div>

      <div
        v-if="session.streamStatus === 'reconnecting'"
        class="text-xs text-[var(--goa-color-warning)] font-medium"
      >
        Reconnecting to stream…
      </div>

      <div class="ml-auto flex flex-wrap gap-2">
        <goa-button
          v-if="session.canStop"
          type="secondary"
          variant="destructive"
          size="compact"
          @_click="handleStop"
        >
          Stop
        </goa-button>
        <goa-button
          v-if="session.canInterject"
          type="secondary"
          size="compact"
          @_click="interjectOpen = true"
        >
          Interject
        </goa-button>
        <goa-button
          v-if="session.canContinue"
          type="primary"
          size="compact"
          @_click="openContinue"
        >
          Continue
        </goa-button>
      </div>
    </div>

    <div
      v-if="continueOpen"
      class="px-4 pb-3 border-t border-[var(--goa-color-border)] bg-[var(--goa-color-background)]"
    >
      <goa-form-item label="Continuation prompt" class="mt-2 block">
        <goa-textarea
          name="continuePrompt"
          :value="continuePrompt"
          rows="3"
          placeholder="What should the agent do next?"
          @_change="(e: CustomEvent<{ value: string }>) => (continuePrompt = e.detail.value)"
        ></goa-textarea>
      </goa-form-item>
      <div class="flex flex-wrap items-center gap-2 mt-2">
        <goa-form-item label="Add iterations">
          <goa-input
            type="number"
            name="continueAdditional"
            :value="continueAdditional == null ? '' : String(continueAdditional)"
            min="1"
            max="100"
            placeholder="optional"
            width="6ch"
            @_change="(e: CustomEvent<{ value: string }>) => (continueAdditional = e.detail.value === '' ? null : Number(e.detail.value))"
          ></goa-input>
        </goa-form-item>
        <div class="ml-auto flex gap-2">
          <goa-button type="secondary" size="compact" @_click="continueOpen = false">
            Cancel
          </goa-button>
          <goa-button
            type="primary"
            size="compact"
            :disabled="!continuePrompt.trim() || undefined"
            @_click="submitContinue"
          >
            Continue Session
          </goa-button>
        </div>
      </div>
    </div>

    <InterjectionModal v-if="interjectOpen" @close="interjectOpen = false" />
  </div>
</template>
