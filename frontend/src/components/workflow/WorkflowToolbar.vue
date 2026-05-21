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
</script>

<script lang="ts">
const statusBadgeType: Record<ExecutionStatus, 'information' | 'success' | 'emergency' | 'important' | 'midtone'> = {
  idle: 'midtone',
  running: 'important',
  completed: 'success',
  error: 'emergency',
  aborted: 'emergency',
}
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-2 bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]">
    <goa-button type="tertiary" size="compact" leadingicon="arrow-back" @_click="emit('back')">
      Workflows
    </goa-button>

    <div class="h-6 w-px bg-[var(--goa-color-border)]" />

    <input
      :value="workflow.name"
      @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      aria-label="Workflow name"
      class="text-base font-semibold bg-transparent border-b border-transparent hover:border-[var(--goa-color-border)] focus:border-[var(--goa-color-primary)] focus:outline-none px-1 min-w-[200px]"
    />

    <span class="text-xs text-[var(--goa-color-text-secondary)]">v{{ workflow.version }}</span>

    <goa-badge v-if="dirty" type="important" content="Unsaved"></goa-badge>

    <div class="flex-1" />

    <goa-form-item label="Classification">
      <goa-dropdown
        name="classification"
        :value="workflow.classification"
        @_change="(e: CustomEvent<{ value: Classification }>) => emit('update:classification', e.detail.value)"
      >
        <goa-dropdown-item
          v-for="c in classifications"
          :key="c"
          :value="c"
          :label="c"
        ></goa-dropdown-item>
      </goa-dropdown>
    </goa-form-item>

    <goa-badge v-if="statusLabel" :type="statusBadgeType[executionStatus]" :content="statusLabel"></goa-badge>

    <goa-button
      type="secondary"
      size="compact"
      :disabled="!dirty || undefined"
      @_click="emit('save')"
    >
      Save
    </goa-button>

    <goa-button
      v-if="executionStatus !== 'running'"
      type="primary"
      size="compact"
      :disabled="dirty || undefined"
      :title="dirty ? 'Save your changes before running' : 'Run the workflow'"
      @_click="emit('run')"
    >
      Run
    </goa-button>

    <goa-button
      v-else
      type="primary"
      variant="destructive"
      size="compact"
      @_click="emit('stop')"
    >
      Stop
    </goa-button>
  </div>
</template>
