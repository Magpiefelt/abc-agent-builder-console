<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { Classification, ExecutionStatus, Workflow } from '@/types/workflow'
import { useWorkflowStore } from '@/stores/workflow'
import { validateCanvas } from '@/lib/workflowValidator'
import ValidationPanel from './ValidationPanel.vue'
import WorkflowTagsEditor from './WorkflowTagsEditor.vue'

const props = defineProps<{
  workflow: Workflow
  dirty: boolean
  executionStatus: ExecutionStatus
  classifications: Classification[]
  models: { id: string; name: string }[]
}>()

// Read-only handle into the workflow store. We don't mutate from here — the
// existing emits still bubble up to WorkflowView for state changes — but we
// do call `select(nodeId)` to jump the PropertiesPanel onto the offending
// node when the user clicks a validation row.
const store = useWorkflowStore()
const { library } = storeToRefs(store)

const validation = computed(() =>
  validateCanvas(props.workflow.canvas_data, library.value),
)
const validationOpen = ref(false)

function toggleValidation(): void {
  validationOpen.value = !validationOpen.value
}

function onValidationSelect(nodeId: string): void {
  store.select(nodeId)
  validationOpen.value = false
}

function onTagsUpdate(tags: string[]): void {
  store.setTags(tags)
}

const tagList = computed<string[]>(() =>
  Array.isArray(props.workflow.tags) ? props.workflow.tags : [],
)

function validationBadgeType(): 'emergency' | 'important' | 'information' | 'success' {
  if (validation.value.counts.error > 0) return 'emergency'
  if (validation.value.counts.warning > 0) return 'important'
  if (validation.value.counts.info > 0) return 'information'
  return 'success'
}

const validationButtonTitle = computed(() => {
  const c = validation.value.counts
  if (c.total === 0) return 'No validation issues detected'
  const parts: string[] = []
  if (c.error) parts.push(`${c.error} error${c.error === 1 ? '' : 's'}`)
  if (c.warning) parts.push(`${c.warning} warning${c.warning === 1 ? '' : 's'}`)
  if (c.info) parts.push(`${c.info} info`)
  return parts.join(' · ')
})

// Tick once a minute so "saved 2m ago" stays accurate without polling the
// store. We don't need second-granularity here — anything older than a minute
// rounds to the nearest minute.
const now = ref(Date.now())
let tickHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickHandle = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => {
  if (tickHandle) clearInterval(tickHandle)
})

const savedAgo = computed(() => {
  if (props.dirty) return ''
  const updated = props.workflow.updated_at
  if (!updated) return ''
  const ts = new Date(updated).getTime()
  if (Number.isNaN(ts)) return ''
  const diff = Math.max(0, now.value - ts)
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
})

const emit = defineEmits<{
  (e: 'save'): void
  (e: 'run'): void
  (e: 'dry-run'): void
  (e: 'stop'): void
  (e: 'update:classification', c: Classification): void
  (e: 'update:name', name: string): void
  (e: 'back'): void
  (e: 'toggle-history'): void
  (e: 'export'): void
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

const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'

const saveTitle = computed(() =>
  props.dirty ? `Save changes (${modKey}+S)` : 'No unsaved changes',
)

const runTitle = computed(() => {
  if (props.dirty) return 'Save your changes before running'
  if (validation.value.counts.error > 0) {
    const n = validation.value.counts.error
    return `Workflow has ${n} validation error${n === 1 ? '' : 's'} — open the Validate panel to fix.`
  }
  return `Run the workflow (${modKey}+Enter)`
})

const dryRunTitle = computed(() => {
  if (props.dirty) return 'Save your changes before running a dry-run'
  if (validation.value.counts.error > 0) {
    const n = validation.value.counts.error
    return `Workflow has ${n} validation error${n === 1 ? '' : 's'} — fix before dry-running.`
  }
  return 'Dry-run: walk the graph with stubbed LLM/tool/function calls. Zero tokens, zero external calls.'
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
  <div class="flex flex-col bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]">
  <div class="flex items-center gap-3 px-4 py-2">
    <goa-button type="tertiary" size="compact" leadingicon="arrow-back" @_click="emit('back')">
      Workflows
    </goa-button>

    <div class="h-6 w-px bg-[var(--goa-color-border)]" />

    <input
      :value="workflow.name"
      @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      aria-label="Workflow name"
      placeholder="Untitled workflow"
      class="text-base font-semibold bg-transparent border-b border-transparent hover:border-[var(--goa-color-border)] focus:border-[var(--goa-color-primary)] focus:outline-none px-1 min-w-[200px] placeholder:italic placeholder:text-[var(--goa-color-text-secondary)] placeholder:font-normal"
    />

    <span class="text-xs text-[var(--goa-color-text-secondary)]">v{{ workflow.version }}</span>

    <goa-badge v-if="dirty" type="important" content="Unsaved"></goa-badge>
    <span
      v-else-if="savedAgo"
      class="text-xs text-[var(--goa-color-text-secondary)]"
      :title="`Saved ${new Date(workflow.updated_at).toLocaleString()}`"
    >
      Saved {{ savedAgo }}
    </span>

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

    <div class="relative">
      <goa-button
        type="tertiary"
        size="compact"
        leadingicon="checkmark-circle"
        :title="validationButtonTitle"
        :aria-expanded="validationOpen"
        aria-haspopup="dialog"
        aria-label="Validation issues"
        @_click="toggleValidation"
      >
        <span class="flex items-center gap-1.5">
          <span>Validate</span>
          <goa-badge
            v-if="validation.counts.total > 0"
            :type="validationBadgeType()"
            :content="String(validation.counts.total)"
          ></goa-badge>
        </span>
      </goa-button>
      <div
        v-if="validationOpen"
        class="absolute right-0 top-full mt-1 z-30"
      >
        <ValidationPanel
          :result="validation"
          :nodes="workflow.canvas_data.nodes"
          @select="onValidationSelect"
          @close="validationOpen = false"
        />
      </div>
    </div>

    <goa-button
      type="tertiary"
      size="compact"
      leadingicon="flask"
      :disabled="dirty || executionStatus === 'running' || validation.counts.error > 0 || undefined"
      :title="dryRunTitle"
      data-testid="dry-run"
      @_click="emit('dry-run')"
    >
      Dry run
    </goa-button>

    <goa-button
      type="tertiary"
      size="compact"
      leadingicon="time-outline"
      title="Versions and runs"
      @_click="emit('toggle-history')"
    >
      History
    </goa-button>

    <goa-button
      type="tertiary"
      size="compact"
      leadingicon="download"
      title="Export this workflow as a portable JSON file"
      @_click="emit('export')"
    >
      Export
    </goa-button>

    <goa-button
      type="secondary"
      size="compact"
      :disabled="!dirty || undefined"
      :title="saveTitle"
      @_click="emit('save')"
    >
      Save
    </goa-button>

    <goa-button
      v-if="executionStatus !== 'running'"
      type="primary"
      size="compact"
      :disabled="dirty || undefined"
      :title="runTitle"
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

  <div
    class="flex items-center gap-2 px-4 py-1.5 border-t border-[var(--goa-color-border)]"
    data-testid="workflow-tags-row"
  >
    <span class="text-xs text-[var(--goa-color-text-secondary)] flex-shrink-0">Tags</span>
    <WorkflowTagsEditor
      :tags="tagList"
      compact
      placeholder="Add tag and press Enter…"
      @update:tags="onTagsUpdate"
    />
  </div>
  </div>
</template>
