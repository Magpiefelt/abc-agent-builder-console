<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAgentSessionStore, type PromptSectionOverride } from '@/stores/agentSession'
import { useAuthStore } from '@/stores/auth'
import { useModelsStore } from '@/stores/models'
import { useUserMemoryStore } from '@/stores/userMemory'
import { useToast } from '@/composables/useToast'
import PromptCustomizer from './PromptCustomizer.vue'

const session = useAgentSessionStore()
const modelsStore = useModelsStore()
const memory = useUserMemoryStore()
const auth = useAuthStore()
const toast = useToast()

const prompt = ref('')
const selectedModelId = ref<string>('')
const classification = ref<'unclassified' | 'protected_a' | 'protected_b'>('unclassified')
const maxIterations = ref(10)
const customizerOpen = ref(false)
const sectionOverrides = ref<Record<string, PromptSectionOverride>>({})

// Save-prompt inline form (Stream A's user-memory feature).
const showSaveForm = ref(false)
const saveTitle = ref('')
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let savedToastTimer: ReturnType<typeof setTimeout> | null = null

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
  if (auth.isAuthenticated) {
    void memory.fetchRecentSessions()
    void memory.fetchSavedPrompts()
  }
})

// When the user authenticates after the panel mounted, lazy-fetch memory.
watch(
  () => auth.isAuthenticated,
  (next) => {
    if (next) {
      void memory.fetchRecentSessions()
      void memory.fetchSavedPrompts()
    }
  },
)

onBeforeUnmount(() => {
  if (savedToastTimer) clearTimeout(savedToastTimer)
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
    if (auth.isAuthenticated) void memory.fetchRecentSessions()
  } catch {
    // error already surfaced via toast in the store
  }
}

function handleNewSession(): void {
  session.reset()
  prompt.value = ''
  sectionOverrides.value = {}
  if (auth.isAuthenticated) void memory.fetchRecentSessions()
}

function handleSaveOverrides(overrides: Record<string, PromptSectionOverride>): void {
  sectionOverrides.value = overrides
  customizerOpen.value = false
}

function openSaveForm(): void {
  saveTitle.value = prompt.value.slice(0, 60).trim() || 'Untitled prompt'
  showSaveForm.value = true
  saveStatus.value = 'idle'
}

function cancelSave(): void {
  showSaveForm.value = false
  saveTitle.value = ''
  saveStatus.value = 'idle'
}

async function confirmSave(): Promise<void> {
  if (!saveTitle.value.trim() || !prompt.value.trim()) return
  saveStatus.value = 'saving'
  const result = await memory.savePrompt({
    title: saveTitle.value.trim(),
    prompt: prompt.value,
  })
  if (result) {
    saveStatus.value = 'saved'
    showSaveForm.value = false
    saveTitle.value = ''
    toast.push({ kind: 'success', message: 'Prompt saved to your library.' })
    if (savedToastTimer) clearTimeout(savedToastTimer)
    savedToastTimer = setTimeout(() => (saveStatus.value = 'idle'), 2200)
  } else {
    saveStatus.value = 'error'
  }
}

function loadFromRecent(p: string): void {
  if (session.status === 'running' || session.status === 'creating') return
  prompt.value = p
}
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] flex flex-col gap-4 p-4 overflow-y-auto h-full"
    aria-label="Task configuration"
  >
    <!-- Recent sessions (Stream A user-memory feature) -->
    <details v-if="memory.recentSessions.length > 0" class="group">
      <summary
        class="text-sm font-semibold text-[var(--goa-color-primary-dark)] cursor-pointer select-none flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded"
      >
        <span>Recent sessions</span>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">{{ memory.recentSessions.length }}</span>
      </summary>
      <ul class="mt-2 space-y-1 max-h-48 overflow-y-auto">
        <li v-for="s in memory.recentSessions" :key="s.id">
          <button
            type="button"
            class="w-full text-left p-2 rounded hover:bg-[var(--goa-color-primary-light)] text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
            @click="loadFromRecent(s.prompt)"
            :title="s.prompt"
          >
            <div class="font-medium line-clamp-1">{{ s.prompt }}</div>
            <div class="text-[var(--goa-color-text-secondary)] mt-0.5">
              {{ s.status }} &middot; {{ new Date(s.createdAt).toLocaleString() }}
            </div>
          </button>
        </li>
      </ul>
    </details>

    <!-- Saved prompts -->
    <details v-if="memory.savedPrompts.length > 0" class="group">
      <summary
        class="text-sm font-semibold text-[var(--goa-color-primary-dark)] cursor-pointer select-none flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded"
      >
        <span>Saved prompts</span>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">{{ memory.savedPrompts.length }}</span>
      </summary>
      <ul class="mt-2 space-y-1 max-h-48 overflow-y-auto">
        <li v-for="p in memory.savedPrompts" :key="p.id">
          <button
            type="button"
            class="w-full text-left p-2 rounded hover:bg-[var(--goa-color-primary-light)] text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
            @click="loadFromRecent(p.prompt)"
            :title="p.prompt"
          >
            <div class="font-medium line-clamp-1">{{ p.title }}</div>
          </button>
        </li>
      </ul>
    </details>

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

    <!-- Save current prompt to user library (Stream A user-memory feature) -->
    <div v-if="auth.isAuthenticated" class="border-t border-[var(--goa-color-border)] pt-3">
      <button
        v-if="!showSaveForm"
        type="button"
        @click="openSaveForm"
        :disabled="!prompt.trim()"
        class="w-full py-2 px-3 text-sm font-medium border border-[var(--goa-color-primary)] text-[var(--goa-color-primary)] rounded-md hover:bg-[var(--goa-color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      >
        Save this prompt
      </button>
      <div v-else class="space-y-2" role="region" aria-label="Save prompt">
        <label for="fa-save-title" class="text-sm font-medium">Prompt title</label>
        <input
          id="fa-save-title"
          v-model="saveTitle"
          type="text"
          maxlength="200"
          class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        />
        <div class="flex gap-2">
          <button
            type="button"
            @click="confirmSave"
            :disabled="!saveTitle.trim() || saveStatus === 'saving'"
            class="flex-1 py-2 px-3 bg-[var(--goa-color-primary)] text-white text-sm font-medium rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--goa-color-primary)]"
          >
            {{ saveStatus === 'saving' ? 'Saving…' : 'Save' }}
          </button>
          <button
            type="button"
            @click="cancelSave"
            class="px-3 py-2 text-sm border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
          >
            Cancel
          </button>
        </div>
        <p v-if="saveStatus === 'error'" class="text-xs text-[var(--goa-color-error)]">
          Could not save. Please try again.
        </p>
      </div>
    </div>

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
