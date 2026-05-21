<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import { renderMarkdown } from '@/composables/useMarkdown'
import type { CanvasNode, NodeData, NodeKind, StageState, StageStatus } from '@/types/workflow'

const store = useWorkflowStore()
const { current, execution } = storeToRefs(store)

const expanded = ref<Set<string>>(new Set())

interface StageRow {
  nodeId: string
  stageIndex: number
  kind: NodeKind
  label: string
  state: StageState
}

function nodeById(): Map<string, CanvasNode> {
  const m = new Map<string, CanvasNode>()
  if (!current.value) return m
  for (const n of current.value.canvas_data.nodes) m.set(n.id, n)
  return m
}

function labelFor(nodeId: string, kind: NodeKind, lookup: Map<string, CanvasNode>): string {
  const data: NodeData | undefined = lookup.get(nodeId)?.data
  if (data && 'label' in data && data.label) return data.label
  return `${kind} ${nodeId.slice(0, 6)}`
}

// Stages are surfaced in the order the executor reported them. Nodes that
// have not started yet (stageIndex undefined) sort to the bottom so the
// running stage is always near the top of the panel.
const rows = computed<StageRow[]>(() => {
  if (!execution.value) return []
  const lookup = nodeById()
  const items: StageRow[] = []
  for (const [nodeId, state] of execution.value.stages) {
    const idx = state.stageIndex ?? Number.MAX_SAFE_INTEGER
    items.push({
      nodeId,
      stageIndex: idx,
      kind: state.kind,
      label: labelFor(nodeId, state.kind, lookup),
      state,
    })
  }
  items.sort((a, b) => a.stageIndex - b.stageIndex)
  return items
})

const counts = computed(() => {
  const acc: Record<StageStatus, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    skipped: 0,
    error: 0,
  }
  for (const r of rows.value) acc[r.state.status]++
  return acc
})

const totalDuration = computed(() => {
  if (!execution.value) return 0
  const end = execution.value.completedAt ?? Date.now()
  return end - execution.value.startedAt
})

// Auto-expand the currently running stage and, once execution finishes,
// auto-expand any stages that ended in error so the operator sees the
// failure without an extra click.
watch(
  rows,
  (list) => {
    if (!execution.value) return
    const next = new Set(expanded.value)
    for (const r of list) {
      if (r.state.status === 'running' || r.state.status === 'error') {
        next.add(r.nodeId)
      }
    }
    expanded.value = next
  },
  { immediate: true },
)

watch(
  () => execution.value?.id,
  () => {
    expanded.value = new Set()
  },
)

function toggle(nodeId: string): void {
  const next = new Set(expanded.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  expanded.value = next
}

function statusBadgeClass(s: StageStatus): string {
  switch (s) {
    case 'running':
      return 'bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]'
    case 'completed':
      return 'bg-green-100 text-[var(--goa-color-success)]'
    case 'skipped':
      return 'bg-gray-100 text-[var(--goa-color-text-secondary)]'
    case 'error':
      return 'bg-red-100 text-[var(--goa-color-error)]'
    default:
      return 'bg-gray-50 text-[var(--goa-color-text-secondary)]'
  }
}

function durationLabel(ms: number | undefined): string {
  if (typeof ms !== 'number' || ms < 0) return ''
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function reasonLabel(reason: string | undefined): string {
  switch (reason) {
    case 'note':
      return 'Note nodes are not executed'
    case 'pruned':
      return 'Pruned by an upstream Branch (matched = false)'
    case 'branch_unmatched':
      return 'Branch did not match this path'
    default:
      return reason ?? ''
  }
}

// Stage values come back as anything (string from Agent, primitive/array/object
// from Function, ToolResult[] from Tool). Render strings as markdown so Agent
// output reads naturally; render structured values as pretty JSON.
function renderValue(value: unknown): { kind: 'markdown' | 'json' | 'empty'; html?: string; text?: string } {
  if (value === null || value === undefined) return { kind: 'empty' }
  if (typeof value === 'string') {
    if (value.length === 0) return { kind: 'empty' }
    return { kind: 'markdown', html: renderMarkdown(value) }
  }
  try {
    return { kind: 'json', text: JSON.stringify(value, null, 2) }
  } catch {
    return { kind: 'json', text: String(value) }
  }
}

defineExpose({ rows, counts })
</script>

<template>
  <section
    v-if="execution"
    class="bg-[var(--goa-color-surface)] border-t border-[var(--goa-color-border)] flex flex-col min-h-0"
    aria-label="Workflow execution results"
  >
    <header class="px-4 py-2 border-b border-[var(--goa-color-border)] flex items-center gap-3 flex-wrap">
      <h3 class="text-sm font-semibold text-[var(--goa-color-primary-dark)]">Execution</h3>
      <span class="text-xs text-[var(--goa-color-text-secondary)]">
        {{ counts.completed }}/{{ rows.length }} completed
        <span v-if="counts.error > 0" class="text-[var(--goa-color-error)] font-medium">
          · {{ counts.error }} failed
        </span>
        <span v-if="counts.skipped > 0">· {{ counts.skipped }} skipped</span>
      </span>
      <span class="text-xs text-[var(--goa-color-text-secondary)]" aria-label="Total duration">
        {{ durationLabel(totalDuration) }}
      </span>
      <span
        v-if="execution.piiBlockedTotal > 0"
        class="text-xs px-2 py-0.5 rounded bg-yellow-100 text-[var(--goa-color-warning)] font-medium"
        :title="`${execution.piiBlockedTotal} PII pattern match${execution.piiBlockedTotal === 1 ? '' : 'es'} blocked before LLM call`"
      >
        ⚠ {{ execution.piiBlockedTotal }} PII blocked
      </span>
      <span
        v-if="execution.error"
        class="text-xs text-[var(--goa-color-error)] flex-1 truncate"
        :title="execution.error"
      >
        {{ execution.error }}
      </span>
      <div class="flex-1" />
      <button
        type="button"
        @click="store.clearExecution"
        :disabled="execution.status === 'running'"
        class="text-xs px-2 py-1 rounded border border-[var(--goa-color-border)] text-[var(--goa-color-text-secondary)] hover:bg-[var(--goa-color-background)] disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Clear execution results"
      >
        Clear
      </button>
    </header>

    <div class="overflow-y-auto flex-1 p-2 flex flex-col gap-2">
      <p
        v-if="rows.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-6 text-center"
      >
        No stages in this workflow.
      </p>

      <article
        v-for="row in rows"
        :key="row.nodeId"
        class="border border-[var(--goa-color-border)] rounded-md"
      >
        <button
          type="button"
          @click="toggle(row.nodeId)"
          :aria-expanded="expanded.has(row.nodeId)"
          :aria-controls="`stage-${row.nodeId}`"
          class="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded-md"
        >
          <span class="text-xs font-mono w-6 text-[var(--goa-color-text-secondary)] shrink-0">
            {{ row.state.stageIndex !== undefined ? `#${row.state.stageIndex + 1}` : '–' }}
          </span>
          <span
            class="text-xs font-medium uppercase tracking-wide w-16 shrink-0 text-[var(--goa-color-text-secondary)]"
            :title="`${row.kind} node`"
          >
            {{ row.kind }}
          </span>
          <span class="text-sm font-medium text-[var(--goa-color-text)] truncate flex-1">
            {{ row.label }}
          </span>
          <span
            :class="['px-2 py-0.5 rounded text-xs font-medium shrink-0', statusBadgeClass(row.state.status)]"
          >
            {{ row.state.status }}
          </span>
          <span
            v-if="row.state.piiBlockedCount"
            class="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-[var(--goa-color-warning)] shrink-0"
            :title="`${row.state.piiBlockedCount} PII match${row.state.piiBlockedCount === 1 ? '' : 'es'} blocked`"
          >
            ⚠
          </span>
          <span
            v-if="row.state.tokens"
            class="text-xs text-[var(--goa-color-text-secondary)] shrink-0"
            :title="`${row.state.tokens} tokens used`"
          >
            {{ row.state.tokens }} tok
          </span>
          <span
            v-if="row.state.durationMs !== undefined"
            class="text-xs text-[var(--goa-color-text-secondary)] shrink-0 w-14 text-right"
          >
            {{ durationLabel(row.state.durationMs) }}
          </span>
        </button>

        <div
          v-if="expanded.has(row.nodeId)"
          :id="`stage-${row.nodeId}`"
          class="px-3 pb-3 pt-2 border-t border-[var(--goa-color-border)] bg-[var(--goa-color-background)] flex flex-col gap-2"
        >
          <p v-if="row.state.status === 'pending'" class="text-sm text-[var(--goa-color-text-secondary)] italic">
            Waiting to run…
          </p>

          <p v-else-if="row.state.status === 'running'" class="text-sm text-[var(--goa-color-text-secondary)] italic">
            Running…
          </p>

          <p
            v-else-if="row.state.status === 'skipped'"
            class="text-sm text-[var(--goa-color-text-secondary)]"
          >
            Skipped — {{ reasonLabel(row.state.reason) }}
          </p>

          <div v-else-if="row.state.status === 'error'">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-error)] mb-1">
              Error
            </h4>
            <pre
              class="text-sm text-[var(--goa-color-error)] whitespace-pre-wrap font-mono p-2 bg-[var(--goa-color-surface)] border border-[var(--goa-color-error)]/30 rounded"
            >{{ row.state.error || 'Unknown error' }}</pre>
          </div>

          <template v-else-if="row.state.status === 'completed'">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
              Output
            </h4>
            <template v-if="renderValue(row.state.value).kind === 'empty'">
              <p class="text-sm text-[var(--goa-color-text-secondary)] italic">
                (no output)
              </p>
            </template>
            <template v-else-if="renderValue(row.state.value).kind === 'markdown'">
              <!-- DOMPurify-sanitized via renderMarkdown; safe to v-html -->
              <div
                class="prose prose-sm max-w-none p-2 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
                v-html="renderValue(row.state.value).html"
              />
            </template>
            <template v-else>
              <pre
                class="text-xs text-[var(--goa-color-text)] whitespace-pre-wrap font-mono p-2 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded max-h-96 overflow-y-auto"
              >{{ renderValue(row.state.value).text }}</pre>
            </template>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>
