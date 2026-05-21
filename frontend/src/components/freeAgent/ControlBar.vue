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
        <button
          v-if="session.canStop"
          type="button"
          @click="handleStop"
          class="px-3 py-1.5 text-sm font-medium border border-[var(--goa-color-error)] text-[var(--goa-color-error)] rounded-md hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Stop
        </button>
        <button
          v-if="session.canInterject"
          type="button"
          @click="interjectOpen = true"
          class="px-3 py-1.5 text-sm font-medium border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Interject
        </button>
        <button
          v-if="session.canContinue"
          type="button"
          @click="openContinue"
          :aria-expanded="continueOpen"
          class="px-3 py-1.5 text-sm font-medium bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Continue
        </button>
      </div>
    </div>

    <div
      v-if="continueOpen"
      class="px-4 pb-3 border-t border-[var(--goa-color-border)] bg-[var(--goa-color-background)]"
    >
      <label for="fa-continue-prompt" class="block text-xs font-medium mt-2 mb-1">Continuation prompt</label>
      <textarea
        id="fa-continue-prompt"
        v-model="continuePrompt"
        rows="3"
        placeholder="What should the agent do next?"
        class="w-full p-2 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      />
      <div class="flex flex-wrap items-center gap-2 mt-2">
        <label for="fa-continue-iter" class="text-xs">Add iterations:</label>
        <input
          id="fa-continue-iter"
          v-model.number="continueAdditional"
          type="number"
          min="1"
          max="100"
          placeholder="optional"
          class="w-24 p-1 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        />
        <div class="ml-auto flex gap-2">
          <button
            type="button"
            @click="continueOpen = false"
            class="px-3 py-1 text-sm border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            @click="submitContinue"
            :disabled="!continuePrompt.trim()"
            class="px-3 py-1 text-sm bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
          >
            Continue Session
          </button>
        </div>
      </div>
    </div>

    <InterjectionModal v-if="interjectOpen" @close="interjectOpen = false" />
  </div>
</template>
