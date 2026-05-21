<script setup lang="ts">
import { computed } from 'vue'
import type { Classification, ExecutionStatus, Workflow } from '@/types/workflow'

const props = defineProps<{
  workflow: Workflow
  dirty: boolean
  executionStatus: ExecutionStatus
  classifications: Classification[]
  models: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  (e: 'save'): void
  (e: 'run'): void
  (e: 'stop'): void
  (e: 'update:classification', c: Classification): void
  (e: 'update:name', name: string): void
  (e: 'back'): void
}>()

const statusLabel = computed(() => {
  switch (props.executionStatus) {
    case 'running': return 'Running'
    case 'completed': return 'Completed'
    case 'error': return 'Failed'
    case 'aborted': return 'Aborted'
    default: return ''
  }
})

const statusClass = computed(() => {
  switch (props.executionStatus) {
    case 'running': return 'bg-[var(--goa-color-warning)] text-[var(--goa-color-text)]'
    case 'completed': return 'bg-[var(--goa-color-success)] text-white'
    case 'error':
    case 'aborted': return 'bg-[var(--goa-color-error)] text-white'
    default: return 'bg-[var(--goa-color-border)] text-[var(--goa-color-text-secondary)]'
  }
})
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-2 bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]">
    <button
      @click="emit('back')"
      class="text-sm text-[var(--goa-color-primary)] hover:underline"
    >
      ← Workflows
    </button>

    <div class="h-6 w-px bg-[var(--goa-color-border)]" />

    <input
      :value="workflow.name"
      @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      class="text-base font-semibold bg-transparent border-b border-transparent hover:border-[var(--goa-color-border)] focus:border-[var(--goa-color-primary)] focus:outline-none px-1 min-w-[200px]"
    />

    <span class="text-xs text-[var(--goa-color-text-secondary)]">v{{ workflow.version }}</span>

    <span v-if="dirty" class="text-xs text-[var(--goa-color-warning)] font-medium">• Unsaved</span>

    <div class="flex-1" />

    <label class="text-xs font-medium">Classification</label>
    <select
      :value="workflow.classification"
      @change="emit('update:classification', ($event.target as HTMLSelectElement).value as Classification)"
      class="text-sm py-1.5 px-2 border border-[var(--goa-color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
    >
      <option v-for="c in classifications" :key="c" :value="c">{{ c }}</option>
    </select>

    <span v-if="statusLabel" :class="statusClass" class="text-xs px-2 py-1 rounded-md font-medium">{{ statusLabel }}</span>

    <button
      @click="emit('save')"
      :disabled="!dirty"
      class="text-sm py-1.5 px-3 bg-[var(--goa-color-surface)] border border-[var(--goa-color-primary)] text-[var(--goa-color-primary)] rounded-md hover:bg-[var(--goa-color-primary-light)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Save
    </button>

    <button
      v-if="executionStatus !== 'running'"
      @click="emit('run')"
      :disabled="dirty"
      :title="dirty ? 'Save your changes before running' : 'Run the workflow'"
      class="text-sm py-1.5 px-3 bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Run
    </button>

    <button
      v-else
      @click="emit('stop')"
      class="text-sm py-1.5 px-3 bg-[var(--goa-color-error)] text-white rounded-md hover:bg-[var(--goa-color-error)]/90"
    >
      Stop
    </button>
  </div>
</template>
