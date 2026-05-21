<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import type {
  WorkflowExecutionDetail,
  WorkflowExecutionSummary,
  WorkflowVersionSummary,
} from '@/types/workflow'

/**
 * Slide-out drawer with two tabs:
 *   - Versions: list workflow_versions rows, preview canvas, restore.
 *   - Runs:     list workflow_executions rows, expand stage_results.
 *
 * Backed by /api/workflows/:id/versions and /api/workflows/:id/executions.
 * Fetches lazily when the drawer opens and refreshes after a restore.
 */
const props = defineProps<{
  open: boolean
  workflowId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useWorkflowStore()
const {
  versions,
  currentVersion,
  executions,
  historyKey,
  historyLoading,
  historyError,
} = storeToRefs(store)

type Tab = 'versions' | 'runs'
const tab = ref<Tab>('versions')

const restoringVersion = ref<number | null>(null)
const restoreError = ref<string | null>(null)
const restoreNotice = ref<string | null>(null)
const expandedExecutionId = ref<string | null>(null)
const executionDetail = ref<WorkflowExecutionDetail | null>(null)
const executionDetailLoading = ref(false)
const executionDetailError = ref<string | null>(null)

const isStale = computed(() => historyKey.value !== props.workflowId)

watch(
  () => [props.open, props.workflowId],
  async ([isOpen, id]) => {
    if (!isOpen || !id) return
    if (isStale.value || versions.value.length === 0) {
      await store.loadHistory(id as string)
    }
  },
  { immediate: true },
)

async function onRestore(v: WorkflowVersionSummary): Promise<void> {
  if (currentVersion.value !== null && v.version === currentVersion.value) return
  if (!window.confirm(`Restore canvas to version ${v.version}? This creates a new version.`)) {
    return
  }
  restoringVersion.value = v.version
  restoreError.value = null
  restoreNotice.value = null
  try {
    await store.restoreVersion(v.version)
    restoreNotice.value = `Restored from v${v.version}. A new snapshot was saved.`
  } catch (err) {
    restoreError.value = (err as Error).message
  } finally {
    restoringVersion.value = null
  }
}

async function onExpandExecution(exec: WorkflowExecutionSummary): Promise<void> {
  if (expandedExecutionId.value === exec.id) {
    expandedExecutionId.value = null
    executionDetail.value = null
    return
  }
  expandedExecutionId.value = exec.id
  executionDetail.value = null
  executionDetailError.value = null
  executionDetailLoading.value = true
  try {
    executionDetail.value = await store.loadExecutionDetail(exec.workflowId, exec.id)
  } catch (err) {
    executionDetailError.value = (err as Error).message
  } finally {
    executionDetailLoading.value = false
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-[var(--goa-color-success)] text-white'
    case 'running':
      return 'bg-[var(--goa-color-warning)] text-[var(--goa-color-text)]'
    case 'error':
    case 'aborted':
      return 'bg-[var(--goa-color-error)] text-white'
    default:
      return 'bg-[var(--goa-color-border)] text-[var(--goa-color-text-secondary)]'
  }
}

function stringifyValue(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="open"
      class="absolute top-0 right-0 bottom-0 w-[420px] max-w-full bg-[var(--goa-color-surface)] border-l border-[var(--goa-color-border)] flex flex-col shadow-xl z-20"
      role="dialog"
      aria-label="Workflow history"
    >
      <header class="px-4 py-3 border-b border-[var(--goa-color-border)] flex items-center gap-3">
        <h3 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] flex-1">History</h3>
        <button
          @click="emit('close')"
          class="text-xs text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)]"
          aria-label="Close history panel"
        >
          ✕
        </button>
      </header>

      <div class="flex border-b border-[var(--goa-color-border)] text-sm" role="tablist">
        <button
          role="tab"
          :aria-selected="tab === 'versions'"
          @click="tab = 'versions'"
          :class="[
            'flex-1 py-2 font-medium border-b-2 transition-colors',
            tab === 'versions'
              ? 'border-[var(--goa-color-primary)] text-[var(--goa-color-primary)]'
              : 'border-transparent text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)]',
          ]"
        >
          Versions ({{ versions.length }})
        </button>
        <button
          role="tab"
          :aria-selected="tab === 'runs'"
          @click="tab = 'runs'"
          :class="[
            'flex-1 py-2 font-medium border-b-2 transition-colors',
            tab === 'runs'
              ? 'border-[var(--goa-color-primary)] text-[var(--goa-color-primary)]'
              : 'border-transparent text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)]',
          ]"
        >
          Runs ({{ executions.length }})
        </button>
      </div>

      <div
        v-if="historyError"
        class="px-4 py-2 text-xs bg-[var(--goa-color-error)]/10 text-[var(--goa-color-error)] border-b border-[var(--goa-color-error)]"
        role="alert"
      >
        {{ historyError }}
      </div>

      <div
        v-if="restoreError"
        class="px-4 py-2 text-xs bg-[var(--goa-color-error)]/10 text-[var(--goa-color-error)] border-b border-[var(--goa-color-error)]"
        role="alert"
      >
        {{ restoreError }}
      </div>

      <div
        v-if="restoreNotice"
        class="px-4 py-2 text-xs bg-[var(--goa-color-success)]/10 text-[var(--goa-color-success)] border-b border-[var(--goa-color-success)]"
        role="status"
      >
        {{ restoreNotice }}
      </div>

      <div v-if="historyLoading" class="flex-1 flex items-center justify-center text-sm text-[var(--goa-color-text-secondary)]">
        Loading history…
      </div>

      <!-- VERSIONS TAB -->
      <div
        v-else-if="tab === 'versions'"
        class="flex-1 overflow-y-auto"
        role="tabpanel"
        aria-label="Versions"
      >
        <ul v-if="versions.length > 0" class="divide-y divide-[var(--goa-color-border)]">
          <li
            v-for="v in versions"
            :key="v.version"
            class="px-4 py-3 flex items-start gap-3"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold">v{{ v.version }}</span>
                <span
                  v-if="currentVersion === v.version"
                  class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--goa-color-primary)] text-white"
                  >Current</span
                >
              </div>
              <div class="text-xs text-[var(--goa-color-text-secondary)]">
                {{ formatDate(v.createdAt) }}
              </div>
              <div class="text-xs text-[var(--goa-color-text-secondary)] truncate">
                {{ v.createdByDisplayName || v.createdByEmail || v.createdBy }}
              </div>
            </div>
            <button
              :disabled="currentVersion === v.version || restoringVersion !== null"
              @click="onRestore(v)"
              class="text-xs py-1 px-2 border border-[var(--goa-color-primary)] text-[var(--goa-color-primary)] rounded hover:bg-[var(--goa-color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {{
                restoringVersion === v.version
                  ? 'Restoring…'
                  : currentVersion === v.version
                  ? 'Active'
                  : 'Restore'
              }}
            </button>
          </li>
        </ul>
        <div v-else class="p-6 text-sm text-[var(--goa-color-text-secondary)] text-center">
          No version history yet.
        </div>
      </div>

      <!-- RUNS TAB -->
      <div
        v-else
        class="flex-1 overflow-y-auto"
        role="tabpanel"
        aria-label="Runs"
      >
        <ul v-if="executions.length > 0" class="divide-y divide-[var(--goa-color-border)]">
          <li
            v-for="exec in executions"
            :key="exec.id"
            class="px-4 py-3"
          >
            <button
              type="button"
              class="w-full text-left"
              :aria-expanded="expandedExecutionId === exec.id"
              @click="onExpandExecution(exec)"
            >
              <div class="flex items-center gap-2">
                <span
                  :class="statusBadgeClass(exec.status)"
                  class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium"
                >
                  {{ exec.status }}
                </span>
                <span class="text-xs text-[var(--goa-color-text-secondary)]">
                  {{ formatDuration(exec.durationMs) }}
                </span>
                <span class="text-xs text-[var(--goa-color-text-secondary)]">·</span>
                <span class="text-xs text-[var(--goa-color-text-secondary)]">{{ exec.stageCount }} stages</span>
                <span class="flex-1" />
                <span class="text-[var(--goa-color-text-secondary)] text-xs">
                  {{ expandedExecutionId === exec.id ? '▾' : '▸' }}
                </span>
              </div>
              <div class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
                {{ formatDate(exec.startedAt) }}
              </div>
              <div class="text-xs text-[var(--goa-color-text-secondary)] truncate">
                {{ exec.userDisplayName || exec.userEmail || exec.userId }}
              </div>
              <div v-if="exec.error" class="text-xs text-[var(--goa-color-error)] mt-1 truncate">
                {{ exec.error }}
              </div>
            </button>

            <div v-if="expandedExecutionId === exec.id" class="mt-3 pl-2 border-l-2 border-[var(--goa-color-border)]">
              <div v-if="executionDetailLoading" class="text-xs text-[var(--goa-color-text-secondary)]">Loading details…</div>
              <div v-else-if="executionDetailError" class="text-xs text-[var(--goa-color-error)]">{{ executionDetailError }}</div>
              <div v-else-if="executionDetail">
                <div v-if="executionDetail.stageResults.length === 0" class="text-xs text-[var(--goa-color-text-secondary)]">
                  No stage results.
                </div>
                <ol v-else class="space-y-2">
                  <li
                    v-for="(stage, idx) in executionDetail.stageResults"
                    :key="`${stage.nodeId}-${idx}`"
                    class="text-xs"
                  >
                    <div class="flex items-center gap-2">
                      <span
                        :class="statusBadgeClass(stage.status)"
                        class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium"
                      >
                        {{ stage.status }}
                      </span>
                      <span class="font-medium">{{ stage.kind }}</span>
                      <span class="text-[var(--goa-color-text-secondary)] truncate">{{ stage.nodeId }}</span>
                      <span v-if="stage.durationMs != null" class="text-[var(--goa-color-text-secondary)]">
                        {{ formatDuration(stage.durationMs) }}
                      </span>
                    </div>
                    <pre
                      v-if="stage.value !== undefined"
                      class="mt-1 p-2 bg-[var(--goa-color-background)] border border-[var(--goa-color-border)] rounded text-[11px] whitespace-pre-wrap break-words overflow-x-auto max-h-40"
                    >{{ stringifyValue(stage.value) }}</pre>
                    <div v-if="stage.error" class="mt-1 text-[var(--goa-color-error)]">
                      {{ stage.error }}
                    </div>
                    <div v-if="stage.reason" class="mt-1 text-[var(--goa-color-text-secondary)] italic">
                      reason: {{ stage.reason }}
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </li>
        </ul>
        <div v-else class="p-6 text-sm text-[var(--goa-color-text-secondary)] text-center">
          No executions yet. Run the workflow to record one here.
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 200ms ease-out;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
