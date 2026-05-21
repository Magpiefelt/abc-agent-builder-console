<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useUserMemoryStore } from '@/stores/userMemory'

const memory = useUserMemoryStore()

const prompt = ref('')
const isRunning = ref(false)
const selectedModel = ref('claude-sonnet-4.5')

const models = [
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Vertex AI' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
]

const showSaveForm = ref(false)
const saveTitle = ref('')
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

onMounted(async () => {
  await Promise.all([memory.fetchRecentSessions(), memory.fetchSavedPrompts()])
})

async function startAgent(): Promise<void> {
  if (!prompt.value.trim()) return
  isRunning.value = true

  try {
    const response = await fetch('/api/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        prompt: prompt.value,
        modelId: selectedModel.value,
      }),
    })
    const session = await response.json()
    console.log('Session created:', session)
    await memory.fetchRecentSessions()
  } catch (err) {
    console.error('Failed to start agent:', err)
  } finally {
    isRunning.value = false
  }
}

function openSaveForm(): void {
  saveTitle.value = prompt.value.slice(0, 60).trim() || 'Untitled prompt'
  showSaveForm.value = true
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
  } else {
    saveStatus.value = 'error'
  }
}

function loadSession(sessionPrompt: string): void {
  prompt.value = sessionPrompt
}

function loadSavedPrompt(promptText: string): void {
  prompt.value = promptText
}
</script>

<template>
  <div class="h-full flex">
    <!-- Left Panel: Task Configuration -->
    <aside
      class="w-80 bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] p-4 flex flex-col gap-4 overflow-y-auto"
    >
      <!-- Recent Sessions -->
      <details v-if="memory.recentSessions.length > 0" class="group">
        <summary
          class="text-sm font-semibold text-[var(--goa-color-primary-dark)] cursor-pointer select-none flex items-center justify-between"
        >
          <span>Recent sessions</span>
          <span class="text-xs text-[var(--goa-color-text-secondary)]">
            {{ memory.recentSessions.length }}
          </span>
        </summary>
        <ul class="mt-2 space-y-1 max-h-48 overflow-y-auto">
          <li v-for="s in memory.recentSessions" :key="s.id">
            <button
              type="button"
              class="w-full text-left p-2 rounded hover:bg-[var(--goa-color-primary-light)] text-xs"
              @click="loadSession(s.prompt)"
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

      <!-- Saved Prompts -->
      <details v-if="memory.savedPrompts.length > 0" class="group">
        <summary
          class="text-sm font-semibold text-[var(--goa-color-primary-dark)] cursor-pointer select-none flex items-center justify-between"
        >
          <span>Saved prompts</span>
          <span class="text-xs text-[var(--goa-color-text-secondary)]">
            {{ memory.savedPrompts.length }}
          </span>
        </summary>
        <ul class="mt-2 space-y-1 max-h-48 overflow-y-auto">
          <li v-for="p in memory.savedPrompts" :key="p.id">
            <button
              type="button"
              class="w-full text-left p-2 rounded hover:bg-[var(--goa-color-primary-light)] text-xs"
              @click="loadSavedPrompt(p.prompt)"
              :title="p.prompt"
            >
              <div class="font-medium line-clamp-1">{{ p.title }}</div>
            </button>
          </li>
        </ul>
      </details>

      <h2 class="text-lg font-semibold text-[var(--goa-color-primary-dark)]">
        Task Configuration
      </h2>

      <!-- Prompt Input -->
      <div class="flex flex-col gap-1">
        <label for="prompt" class="text-sm font-medium">Task Description</label>
        <textarea
          id="prompt"
          v-model="prompt"
          placeholder="Describe what you want the agent to do..."
          class="w-full h-32 p-3 border border-[var(--goa-color-border)] rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)] text-sm"
        />
      </div>

      <!-- Model Selection -->
      <div class="flex flex-col gap-1">
        <label for="model" class="text-sm font-medium">Model</label>
        <select
          id="model"
          v-model="selectedModel"
          class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
        >
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ model.name }} ({{ model.provider }})
          </option>
        </select>
      </div>

      <!-- Start Button -->
      <button
        @click="startAgent"
        :disabled="!prompt.trim() || isRunning"
        class="w-full py-2.5 px-4 bg-[var(--goa-color-primary)] text-white font-medium rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {{ isRunning ? 'Running...' : 'Start Agent' }}
      </button>

      <!-- Save Prompt Button + inline form -->
      <div class="border-t border-[var(--goa-color-border)] pt-3">
        <button
          v-if="!showSaveForm"
          type="button"
          @click="openSaveForm"
          :disabled="!prompt.trim()"
          class="w-full py-2 px-4 border border-[var(--goa-color-primary)] text-[var(--goa-color-primary)] font-medium rounded-md hover:bg-[var(--goa-color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
        >
          Save this prompt
        </button>

        <div v-else class="space-y-2">
          <label for="saveTitle" class="text-sm font-medium">Prompt title</label>
          <input
            id="saveTitle"
            v-model="saveTitle"
            type="text"
            maxlength="200"
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          />
          <div class="flex gap-2">
            <button
              type="button"
              @click="confirmSave"
              :disabled="!saveTitle.trim() || saveStatus === 'saving'"
              class="flex-1 py-2 px-3 bg-[var(--goa-color-primary)] text-white font-medium rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 text-sm"
            >
              {{ saveStatus === 'saving' ? 'Saving...' : 'Save' }}
            </button>
            <button
              type="button"
              @click="showSaveForm = false"
              class="px-3 py-2 border border-[var(--goa-color-border)] rounded-md text-sm"
            >
              Cancel
            </button>
          </div>
          <p
            v-if="saveStatus === 'error'"
            class="text-xs text-[var(--goa-color-error)]"
          >
            Could not save. Please try again.
          </p>
        </div>
      </div>
    </aside>

    <!-- Center: Execution Canvas (placeholder) -->
    <div class="flex-1 flex items-center justify-center bg-gray-50">
      <div class="text-center text-gray-400">
        <div class="text-5xl mb-4">🤖</div>
        <h3 class="text-lg font-medium">No Active Session</h3>
        <p class="text-sm mt-1">Enter a task and click "Start Agent" to begin.</p>
      </div>
    </div>

    <!-- Right Panel: Memory Viewer -->
    <aside
      class="w-80 bg-[var(--goa-color-surface)] border-l border-[var(--goa-color-border)] p-4 flex flex-col overflow-y-auto"
    >
      <div class="flex gap-2 mb-4">
        <button
          class="px-3 py-1 text-sm font-medium bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)] rounded"
        >
          Blackboard
        </button>
        <button
          class="px-3 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded"
        >
          Artifacts
        </button>
        <button
          class="px-3 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded"
        >
          Raw
        </button>
      </div>
      <div class="flex-1 flex items-center justify-center text-gray-400 text-sm">
        No blackboard entries yet
      </div>
    </aside>
  </div>
</template>
