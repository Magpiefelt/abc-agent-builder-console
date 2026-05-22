<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentSessionStore, type PromptSectionOverride } from '@/stores/agentSession'
import { useAuthStore } from '@/stores/auth'
import { useModelsStore } from '@/stores/models'
import { useUserMemoryStore } from '@/stores/userMemory'
import { useToast } from '@/composables/useToast'
import PromptCustomizer from './PromptCustomizer.vue'

const session = useAgentSessionStore()
const route = useRoute()
const router = useRouter()
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

// Accordion open/closed state — persisted so the user's preference survives
// page reloads.
function readSection(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const v = localStorage.getItem(`abc.taskpanel.${key}`)
  if (v === 'open') return true
  if (v === 'closed') return false
  return fallback
}
function writeSection(key: string, open: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`abc.taskpanel.${key}`, open ? 'open' : 'closed')
}

const libraryOpen = ref(readSection('library', false))
const taskOpen = ref(readSection('task', true))
const promptOpen = ref(readSection('prompt', false))

watch(libraryOpen, (v) => writeSection('library', v))
watch(taskOpen, (v) => writeSection('task', v))
watch(promptOpen, (v) => writeSection('prompt', v))

// Save-prompt inline form (Stream A's user-memory feature). Lives inside the
// "Prompt customization" section now, not as a top-level action.
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
  if (session.status === 'completed' || session.status === 'error') return 'Start new session'
  return 'Start agent'
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
const overrideBadge = computed(() =>
  overrideCount.value > 0
    ? `${overrideCount.value} override${overrideCount.value === 1 ? '' : 's'}`
    : '',
)

const startRunning = computed(
  () => session.status === 'creating' || session.status === 'running',
)
const showNewSession = computed(
  () =>
    !session.replayMode &&
    (session.status === 'completed' ||
      session.status === 'error' ||
      session.status === 'paused' ||
      session.status === 'needs_assistance'),
)
const modKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'

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
  const queryPrompt = route.query.prompt
  if (typeof queryPrompt === 'string' && queryPrompt.length > 0) {
    prompt.value = queryPrompt
    const { prompt: _omit, ...rest } = route.query
    void router.replace({ query: rest })
  }
})

watch(
  () => auth.isAuthenticated,
  (next) => {
    if (next) {
      void memory.fetchRecentSessions()
      void memory.fetchSavedPrompts()
    }
  },
)

watch(
  () => session.replayMode && session.sessionMeta,
  (meta) => {
    if (!meta) return
    prompt.value = meta.prompt
    selectedModelId.value = meta.modelId
    if (
      meta.classification === 'unclassified' ||
      meta.classification === 'protected_a' ||
      meta.classification === 'protected_b'
    ) {
      classification.value = meta.classification
    }
    maxIterations.value = meta.maxIterations
  },
  { immediate: true },
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

function handleKeyDown(event: KeyboardEvent): void {
  const mod = event.metaKey || event.ctrlKey
  if (!mod || event.key !== 'Enter') return
  if (session.replayMode) return
  if (startDisabled.value || classificationWarning.value) return
  event.preventDefault()
  void handleStart()
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

function viewSession(id: string): void {
  router.push({ name: 'session-replay', params: { id } })
}

function exitReplayAndReset(): void {
  session.reset()
  router.push({ name: 'free-agent' })
}
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] flex flex-col h-full overflow-hidden"
    aria-label="Task configuration"
    @keydown="handleKeyDown"
  >
    <header class="px-4 pt-4 pb-2 shrink-0">
      <h2 class="text-xl font-bold text-[var(--goa-color-text-default)] m-0">
        {{ session.replayMode ? 'Session Replay' : 'Task Configuration' }}
      </h2>
    </header>

    <!-- Scrollable accordion body -->
    <div class="flex-1 overflow-y-auto px-4 pb-3">
      <!-- Library (closed by default) — scaffolding, not the primary work. -->
      <details
        v-if="memory.recentSessions.length > 0 || memory.savedPrompts.length > 0"
        class="py-2 border-b border-[var(--goa-color-border)]"
        :open="libraryOpen"
        @toggle="libraryOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="text-sm font-semibold text-[var(--goa-color-text-default)] cursor-pointer select-none flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded px-1 py-1"
        >
          <span>Library</span>
          <span class="text-xs text-[var(--goa-color-text-secondary)]">
            {{ memory.recentSessions.length + memory.savedPrompts.length }}
          </span>
        </summary>

        <div class="mt-2 flex flex-col gap-4">
          <div v-if="memory.recentSessions.length > 0">
            <h3 class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)] m-0 mb-1">
              Recent sessions
            </h3>
            <ul class="space-y-1 max-h-48 overflow-y-auto m-0 p-0 list-none">
              <li
                v-for="s in memory.recentSessions"
                :key="s.id"
                class="flex items-stretch gap-1"
              >
                <button
                  type="button"
                  class="flex-1 text-left p-2 rounded hover:bg-[var(--goa-color-primary-light)] text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
                  @click="loadFromRecent(s.prompt)"
                  :title="`Use this prompt: ${s.prompt}`"
                >
                  <div class="font-medium line-clamp-1">{{ s.prompt }}</div>
                  <div class="text-[var(--goa-color-text-secondary)] mt-0.5">
                    {{ s.status }} · {{ new Date(s.createdAt).toLocaleString() }}
                  </div>
                </button>
                <button
                  type="button"
                  class="shrink-0 px-2 rounded text-xs text-[var(--goa-color-primary)] hover:bg-[var(--goa-color-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
                  :title="`View session ${s.id}`"
                  aria-label="View this session in replay mode"
                  @click="viewSession(s.id)"
                >
                  View
                </button>
              </li>
            </ul>
          </div>

          <div v-if="memory.savedPrompts.length > 0">
            <h3 class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)] m-0 mb-1">
              Saved prompts
            </h3>
            <ul class="space-y-1 max-h-48 overflow-y-auto m-0 p-0 list-none">
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
          </div>
        </div>
      </details>

      <!-- Replay callout floats above the Task section when in replay mode. -->
      <goa-callout
        v-if="session.replayMode"
        type="information"
        heading="Read-only replay"
        class="my-3"
      >
        You're viewing a past session. To run a new task, exit replay first.
      </goa-callout>

      <!-- Task (open by default) — the primary work. -->
      <details
        class="py-2 border-b border-[var(--goa-color-border)]"
        :open="taskOpen"
        @toggle="taskOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="text-sm font-semibold text-[var(--goa-color-text-default)] cursor-pointer select-none flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded px-1 py-1"
        >
          <span>Task</span>
          <goa-badge
            v-if="classificationWarning"
            type="important"
            content="check"
          ></goa-badge>
        </summary>

        <div class="mt-3 flex flex-col gap-3">
          <goa-form-item
            label="Task description"
            helptext="Outline the task in plain language. Be specific about the source documents the agent should use and what the final report should contain."
            requirement="required"
          >
            <goa-textarea
              name="prompt"
              :value="prompt"
              rows="6"
              placeholder="What should the agent do?"
              :disabled="startRunning || session.replayMode || undefined"
              @_change="(e: CustomEvent<{ value: string }>) => (prompt = e.detail.value)"
            ></goa-textarea>
          </goa-form-item>

          <goa-form-item label="Model" requirement="required">
            <goa-dropdown
              name="modelId"
              :value="selectedModelId"
              :disabled="modelsStore.loading || startRunning || session.replayMode || undefined"
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
            <div
              v-if="modelsStore.error"
              slot="helptext"
              class="flex items-center gap-2 text-[var(--goa-color-error)]"
            >
              <span class="text-xs">{{ modelsStore.error }}</span>
              <goa-button type="tertiary" size="compact" @_click="modelsStore.ensureLoaded()">
                Retry
              </goa-button>
            </div>
          </goa-form-item>

          <goa-form-item
            label="Classification"
            helptext="Pick the highest classification of any data the agent will touch. Some models cap at lower levels."
            requirement="required"
          >
            <goa-dropdown
              name="classification"
              :value="classification"
              :disabled="startRunning || session.replayMode || undefined"
              width="100%"
              @_change="(e: CustomEvent<{ value: 'unclassified' | 'protected_a' | 'protected_b' }>) => (classification = e.detail.value)"
            >
              <goa-dropdown-item value="unclassified" label="Unclassified"></goa-dropdown-item>
              <goa-dropdown-item value="protected_a" label="Protected A"></goa-dropdown-item>
              <goa-dropdown-item value="protected_b" label="Protected B"></goa-dropdown-item>
            </goa-dropdown>
          </goa-form-item>

          <goa-callout
            v-if="classificationWarning"
            type="important"
            heading="Classification mismatch"
          >
            {{ classificationWarning }}
          </goa-callout>

          <goa-form-item
            label="Max iterations"
            helptext="Hard cap on agent turns. Default 10; raise carefully — long sessions cost more."
          >
            <goa-input
              type="number"
              name="maxIterations"
              :value="String(maxIterations)"
              min="1"
              max="100"
              :disabled="startRunning || session.replayMode || undefined"
              width="100%"
              @_change="(e: CustomEvent<{ value: string }>) => (maxIterations = Number(e.detail.value) || 10)"
            ></goa-input>
          </goa-form-item>
        </div>
      </details>

      <!-- Prompt customization (closed by default) — power-user scaffolding. -->
      <details
        v-if="!session.replayMode"
        class="py-2"
        :open="promptOpen"
        @toggle="promptOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="text-sm font-semibold text-[var(--goa-color-text-default)] cursor-pointer select-none flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded px-1 py-1"
        >
          <span>Prompt customization</span>
          <goa-badge
            v-if="overrideCount > 0"
            type="information"
            :content="overrideBadge"
          ></goa-badge>
        </summary>

        <div class="mt-3 flex flex-col gap-3">
          <goa-button type="secondary" @_click="customizerOpen = true">
            Edit prompt sections
          </goa-button>

          <div
            v-if="auth.isAuthenticated"
            class="pt-3 border-t border-[var(--goa-color-border)]"
          >
            <goa-button
              v-if="!showSaveForm"
              type="tertiary"
              :disabled="!prompt.trim() || undefined"
              @_click="openSaveForm"
            >
              Save this prompt to library
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
                  size="compact"
                  :disabled="!saveTitle.trim() || saveStatus === 'saving' || undefined"
                  @_click="confirmSave"
                >
                  {{ saveStatus === 'saving' ? 'Saving…' : 'Save' }}
                </goa-button>
                <goa-button type="secondary" size="compact" @_click="cancelSave">
                  Cancel
                </goa-button>
              </div>
              <goa-callout v-if="saveStatus === 'error'" type="emergency" heading="Couldn't save">
                Please try again.
              </goa-callout>
            </div>
          </div>
        </div>
      </details>
    </div>

    <!--
      Sticky bottom button group. Start agent (or Exit replay) is the
      unmistakable primary; New session shows up after a run completes.
    -->
    <div
      class="shrink-0 border-t border-[var(--goa-color-border)] bg-[var(--goa-color-surface)] p-4 flex flex-col gap-2"
    >
      <template v-if="!session.replayMode">
        <goa-button
          type="primary"
          :disabled="startDisabled || !!classificationWarning || undefined"
          :title="`Start agent (${modKey}+↵)`"
          @_click="handleStart"
        >
          {{ startLabel }}
        </goa-button>
        <goa-button v-if="showNewSession" type="secondary" @_click="handleNewSession">
          New session
        </goa-button>
        <p
          v-if="!startRunning"
          class="text-xs text-[var(--goa-color-text-secondary)] m-0 text-center"
          aria-hidden="true"
        >
          {{ modKey }}+↵ to start
        </p>
      </template>
      <template v-else>
        <goa-button type="primary" @_click="exitReplayAndReset">
          Exit replay
        </goa-button>
      </template>
    </div>

    <PromptCustomizer
      v-if="customizerOpen"
      :initial-overrides="sectionOverrides"
      @save="handleSaveOverrides"
      @close="customizerOpen = false"
    />
  </section>
</template>
