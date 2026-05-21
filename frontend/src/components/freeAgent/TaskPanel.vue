<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAgentSessionStore, type PromptSectionOverride } from '@/stores/agentSession'
import { useModelsStore } from '@/stores/models'
import PromptCustomizer from './PromptCustomizer.vue'

const session = useAgentSessionStore()
const modelsStore = useModelsStore()

const prompt = ref('')
const selectedModelId = ref<string>('')
const classification = ref<'unclassified' | 'protected_a' | 'protected_b'>('unclassified')
const maxIterations = ref(10)
const customizerOpen = ref(false)
const sectionOverrides = ref<Record<string, PromptSectionOverride>>({})

const startDisabled = computed(
  () =>
    !prompt.value.trim() ||
    !selectedModelId.value ||
    (session.status !== 'idle' &&
      session.status !== 'error' &&
      session.status !== 'completed'),
)

const startLabel = computed(() => {
  if (session.status === 'creating') return 'Starting…'
  if (session.status === 'running') return 'Running…'
  if (session.status === 'completed' || session.status === 'error') return 'Start New Session'
  return 'Start Agent'
})

const selectedModel = computed(() =>
  modelsStore.models.find((m) => m.id === selectedModelId.value),
)

const classificationWarning = computed(() => {
  const m = selectedModel.value
  if (!m) return null
  const order = ['unclassified', 'protected_a', 'protected_b']
  const selectedRank = order.indexOf(classification.value)
  const maxRank = order.indexOf(m.maxClassification)
  if (selectedRank > maxRank) {
    return `${m.name} only supports up to "${m.maxClassification.replace('_', ' ')}".`
  }
  return null
})

const overrideCount = computed(() => Object.keys(sectionOverrides.value).length)

onMounted(async () => {
  await modelsStore.ensureLoaded()
  const first = modelsStore.models[0]
  if (!selectedModelId.value && first) {
    selectedModelId.value = first.id
  }
})

async function handleStart(): Promise<void> {
  if (startDisabled.value) return
  if (classificationWarning.value) return
  try {
    await session.createSession({
      prompt: prompt.value.trim(),
      modelId: selectedModelId.value,
      classification: classification.value,
      maxIterations: Math.min(Math.max(maxIterations.value || 10, 1), 100),
    })
    await session.startStream({
      sectionOverrides: overrideCount.value > 0 ? sectionOverrides.value : undefined,
    })
  } catch {
    // error already surfaced via toast in the store
  }
}

function handleNewSession(): void {
  session.reset()
  prompt.value = ''
  sectionOverrides.value = {}
}

function handleSaveOverrides(overrides: Record<string, PromptSectionOverride>): void {
  sectionOverrides.value = overrides
  customizerOpen.value = false
}
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] flex flex-col gap-4 p-4 overflow-y-auto h-full"
    aria-label="Task configuration"
  >
    <h2 class="text-lg font-semibold text-[var(--goa-color-primary-dark)]">Task Configuration</h2>

    <div class="flex flex-col gap-1">
      <label for="fa-prompt" class="text-sm font-medium">Task Description</label>
      <textarea
        id="fa-prompt"
        v-model="prompt"
        rows="6"
        placeholder="Describe what you want the agent to do..."
        :disabled="session.status === 'running' || session.status === 'creating'"
        class="w-full p-3 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] disabled:opacity-60"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label for="fa-model" class="text-sm font-medium">Model</label>
      <select
        id="fa-model"
        v-model="selectedModelId"
        :disabled="modelsStore.loading || session.status === 'running' || session.status === 'creating'"
        class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      >
        <option v-if="modelsStore.loading" disabled value="">Loading models…</option>
        <option v-else-if="modelsStore.models.length === 0" disabled value="">No models available</option>
        <option v-for="m in modelsStore.models" :key="m.id" :value="m.id">
          {{ m.name }}
        </option>
      </select>
      <div v-if="modelsStore.error" class="flex items-center gap-2 text-xs text-[var(--goa-color-error)]">
        <span>{{ modelsStore.error }}</span>
        <button
          type="button"
          @click="modelsStore.ensureLoaded()"
          class="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded"
        >
          Retry
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <label for="fa-classification" class="text-sm font-medium">Classification</label>
      <select
        id="fa-classification"
        v-model="classification"
        :disabled="session.status === 'running' || session.status === 'creating'"
        class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      >
        <option value="unclassified">Unclassified</option>
        <option value="protected_a">Protected A</option>
        <option value="protected_b">Protected B</option>
      </select>
    </div>

    <div class="flex flex-col gap-1">
      <label for="fa-max-iter" class="text-sm font-medium">Max Iterations</label>
      <input
        id="fa-max-iter"
        v-model.number="maxIterations"
        type="number"
        min="1"
        max="100"
        :disabled="session.status === 'running' || session.status === 'creating'"
        class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      />
    </div>

    <button
      type="button"
      @click="customizerOpen = true"
      class="w-full py-2 px-3 text-sm font-medium border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] text-left flex items-center justify-between"
    >
      <span>Customize Prompt</span>
      <span
        v-if="overrideCount > 0"
        class="text-xs px-2 py-0.5 rounded-full bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]"
      >
        {{ overrideCount }} override{{ overrideCount === 1 ? '' : 's' }}
      </span>
    </button>

    <p
      v-if="classificationWarning"
      class="text-xs text-[var(--goa-color-warning)] bg-yellow-50 border border-yellow-200 rounded p-2"
      role="alert"
    >
      {{ classificationWarning }}
    </p>

    <button
      type="button"
      @click="handleStart"
      :disabled="startDisabled || !!classificationWarning"
      class="w-full py-2.5 px-4 bg-[var(--goa-color-primary)] text-white font-medium rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--goa-color-primary)]"
    >
      {{ startLabel }}
    </button>

    <button
      v-if="session.status === 'completed' || session.status === 'error' || session.status === 'paused' || session.status === 'needs_assistance'"
      type="button"
      @click="handleNewSession"
      class="w-full py-2 px-3 text-sm font-medium border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
    >
      New Session
    </button>

    <PromptCustomizer
      v-if="customizerOpen"
      :initial-overrides="sectionOverrides"
      @save="handleSaveOverrides"
      @close="customizerOpen = false"
    />
  </section>
</template>
