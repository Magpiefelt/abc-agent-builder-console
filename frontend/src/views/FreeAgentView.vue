<script setup lang="ts">
import { ref } from 'vue'

const prompt = ref('')
const isRunning = ref(false)
const selectedModel = ref('claude-sonnet-4.5')

const models = [
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'Vertex AI' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
]

async function startAgent() {
  if (!prompt.value.trim()) return
  isRunning.value = true

  try {
    const response = await fetch('/api/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt.value,
        modelId: selectedModel.value,
      }),
    })
    const session = await response.json()
    console.log('Session created:', session)

    // TODO: Start SSE stream for execution updates
  } catch (err) {
    console.error('Failed to start agent:', err)
  } finally {
    isRunning.value = false
  }
}
</script>

<template>
  <div class="h-full flex">
    <!-- Left Panel: Task Configuration -->
    <aside class="w-80 bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] p-4 flex flex-col gap-4 overflow-y-auto">
      <h2 class="text-lg font-semibold text-[var(--goa-color-primary-dark)]">Task Configuration</h2>

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
    <aside class="w-80 bg-[var(--goa-color-surface)] border-l border-[var(--goa-color-border)] p-4 flex flex-col overflow-y-auto">
      <div class="flex gap-2 mb-4">
        <button class="px-3 py-1 text-sm font-medium bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)] rounded">
          Blackboard
        </button>
        <button class="px-3 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded">
          Artifacts
        </button>
        <button class="px-3 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded">
          Raw
        </button>
      </div>
      <div class="flex-1 flex items-center justify-center text-gray-400 text-sm">
        No blackboard entries yet
      </div>
    </aside>
  </div>
</template>
