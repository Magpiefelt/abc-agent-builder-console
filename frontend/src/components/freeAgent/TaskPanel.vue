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

    <goa-form-item label="Task Description">
      <goa-textarea
        name="prompt"
        :value="prompt"
        rows="6"
        placeholder="Describe what you want the agent to do..."
        :disabled="session.status === 'running' || session.status === 'creating' || undefined"
        @_change="(e: CustomEvent<{ value: string }>) => (prompt = e.detail.value)"
      ></goa-textarea>
    </goa-form-item>

    <goa-form-item label="Model" :helptext="modelsStore.error ?? ''">
      <goa-dropdown
        name="modelId"
        :value="selectedModelId"
        :disabled="modelsStore.loading || session.status === 'running' || session.status === 'creating' || undefined"
        width="100%"
        @_change="(e: CustomEvent<{ value: string }>) => (selectedModelId = e.detail.value)"
      >
        <goa-dropdown-item
          v-for="m in modelsStore.models"
          :key="m.id"
          :value="m.id"
          :label="m.name"
        ></goa-dropdown-item>
      </goa-dropdown>
      <goa-button
        v-if="modelsStore.error"
        type="tertiary"
        size="compact"
        slot="helptext"
        @_click="modelsStore.ensureLoaded()"
      >
        Retry
      </goa-button>
    </goa-form-item>

    <goa-form-item label="Classification">
      <goa-dropdown
        name="classification"
        :value="classification"
        :disabled="session.status === 'running' || session.status === 'creating' || undefined"
        width="100%"
        @_change="(e: CustomEvent<{ value: 'unclassified' | 'protected_a' | 'protected_b' }>) => (classification = e.detail.value)"
      >
        <goa-dropdown-item value="unclassified" label="Unclassified"></goa-dropdown-item>
        <goa-dropdown-item value="protected_a" label="Protected A"></goa-dropdown-item>
        <goa-dropdown-item value="protected_b" label="Protected B"></goa-dropdown-item>
      </goa-dropdown>
    </goa-form-item>

    <goa-form-item label="Max Iterations">
      <goa-input
        type="number"
        name="maxIterations"
        :value="String(maxIterations)"
        min="1"
        max="100"
        :disabled="session.status === 'running' || session.status === 'creating' || undefined"
        width="100%"
        @_change="(e: CustomEvent<{ value: string }>) => (maxIterations = Number(e.detail.value) || 10)"
      ></goa-input>
    </goa-form-item>

    <goa-button
      type="secondary"
      @_click="customizerOpen = true"
    >
      <span>Customize Prompt</span>
      <goa-badge
        v-if="overrideCount > 0"
        type="information"
        :content="`${overrideCount} override${overrideCount === 1 ? '' : 's'}`"
      ></goa-badge>
    </goa-button>

    <goa-callout
      v-if="classificationWarning"
      type="important"
      heading="Classification mismatch"
    >
      {{ classificationWarning }}
    </goa-callout>

    <goa-button
      type="primary"
      :disabled="startDisabled || !!classificationWarning || undefined"
      @_click="handleStart"
    >
      {{ startLabel }}
    </goa-button>

    <!-- Save current prompt to user library (Stream A user-memory feature) -->
    <div v-if="auth.isAuthenticated" class="border-t border-[var(--goa-color-border)] pt-3">
      <goa-button
        v-if="!showSaveForm"
        type="secondary"
        :disabled="!prompt.trim() || undefined"
        @_click="openSaveForm"
      >
        Save this prompt
      </goa-button>
      <div v-else class="space-y-2" role="region" aria-label="Save prompt">
        <goa-form-item label="Prompt title">
          <goa-input
            name="saveTitle"
            :value="saveTitle"
            maxlength="200"
            width="100%"
            @_change="(e: CustomEvent<{ value: string }>) => (saveTitle = e.detail.value)"
          ></goa-input>
        </goa-form-item>
        <div class="flex gap-2">
          <goa-button
            type="primary"
            :disabled="!saveTitle.trim() || saveStatus === 'saving' || undefined"
            @_click="confirmSave"
          >
            {{ saveStatus === 'saving' ? 'Saving…' : 'Save' }}
          </goa-button>
          <goa-button type="secondary" @_click="cancelSave">Cancel</goa-button>
        </div>
        <goa-callout v-if="saveStatus === 'error'" type="emergency" heading="Couldn't save">
          Please try again.
        </goa-callout>
      </div>
    </div>

    <goa-button
      v-if="session.status === 'completed' || session.status === 'error' || session.status === 'paused' || session.status === 'needs_assistance'"
      type="secondary"
      @_click="handleNewSession"
    >
      New Session
    </goa-button>

    <PromptCustomizer
      v-if="customizerOpen"
      :initial-overrides="sectionOverrides"
      @save="handleSaveOverrides"
      @close="customizerOpen = false"
    />
  </section>
</template>
