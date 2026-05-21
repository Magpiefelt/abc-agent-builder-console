<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import { describeNode, describeEdge } from '@/lib/canvasDiff'
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
 *
 * Versions tab supports an inline preview mode: clicking Preview on a version
 * loads its canvas, computes a diff vs the live canvas, and renders a
 * non-destructive summary the user can restore from or back out of.
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
  versionPreview,
  previewLoading,
  previewError,
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

const restoreTarget = ref<WorkflowVersionSummary | null>(null)

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

// Closing the drawer abandons any preview-in-progress.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) store.clearVersionPreview()
  },
)

function askRestore(v: WorkflowVersionSummary): void {
  if (currentVersion.value !== null && v.version === currentVersion.value) return
  restoreTarget.value = v
}

async function onPreview(v: WorkflowVersionSummary): Promise<void> {
  if (currentVersion.value !== null && v.version === currentVersion.value) return
  await store.previewVersion(v.version)
}

function onClosePreview(): void {
  store.clearVersionPreview()
}

async function restoreFromPreview(): Promise<void> {
  if (!versionPreview.value) return
  const version = versionPreview.value.version
  restoringVersion.value = version
  restoreError.value = null
  restoreNotice.value = null
  try {
    await store.restoreVersion(version)
    restoreNotice.value = `Restored from v${version}. A new snapshot was saved.`
  } catch (err) {
    restoreError.value = (err as Error).message
  } finally {
    restoringVersion.value = null
  }
}

async function confirmRestore(): Promise<void> {
  const v = restoreTarget.value
  if (!v) return
  restoreTarget.value = null
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

const previewHasChanges = computed(() => versionPreview.value?.summary.hasChanges ?? false)

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

function statusBadgeType(status: string): 'success' | 'important' | 'emergency' | 'midtone' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'important'
    case 'error':
    case 'aborted':
      return 'emergency'
    default:
      return 'midtone'
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
        <goa-icon-button
          icon="close"
          size="small"
          ariaLabel="Close history panel"
          @_click="emit('close')"
        ></goa-icon-button>
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

      <goa-callout
        v-if="historyError"
        type="emergency"
        heading="Couldn't load history"
        class="m-3"
      >
        {{ historyError }}
      </goa-callout>

      <goa-callout
        v-if="restoreError"
        type="emergency"
        heading="Restore failed"
        class="m-3"
      >
        {{ restoreError }}
      </goa-callout>

      <goa-callout
        v-if="restoreNotice"
        type="success"
        heading="Restored"
        class="m-3"
      >
        {{ restoreNotice }}
      </goa-callout>

      <goa-callout
        v-if="previewError"
        type="emergency"
        heading="Preview failed"
        class="m-3"
      >
        {{ previewError }}
      </goa-callout>

      <div
        v-if="previewLoading"
        class="px-4 py-2 text-xs text-[var(--goa-color-text-secondary)]"
        role="status"
        aria-live="polite"
      >
        Loading version preview…
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
        <!-- PREVIEW MODE -->
        <div v-if="versionPreview" class="p-4 space-y-3" aria-label="Version preview">
          <div class="flex items-center gap-2">
            <goa-button type="tertiary" size="compact" leadingicon="arrow-back" @_click="onClosePreview">
              Back
            </goa-button>
            <h4 class="text-sm font-semibold flex-1">
              Preview v{{ versionPreview.version }}
              <span v-if="currentVersion !== null" class="font-normal text-[var(--goa-color-text-secondary)]">
                vs v{{ currentVersion }}
              </span>
            </h4>
          </div>

          <p v-if="!previewHasChanges" class="text-xs text-[var(--goa-color-text-secondary)]">
            This version is structurally identical to the current canvas.
          </p>

          <div v-else class="space-y-3 text-xs">
            <div class="flex flex-wrap gap-2">
              <goa-badge
                v-if="versionPreview.summary.nodeAdded > 0"
                type="success"
                :content="`+${versionPreview.summary.nodeAdded} nodes`"
              ></goa-badge>
              <goa-badge
                v-if="versionPreview.summary.nodeRemoved > 0"
                type="emergency"
                :content="`−${versionPreview.summary.nodeRemoved} nodes`"
              ></goa-badge>
              <goa-badge
                v-if="versionPreview.summary.nodeModified > 0"
                type="important"
                :content="`~${versionPreview.summary.nodeModified} modified`"
              ></goa-badge>
              <goa-badge
                v-if="versionPreview.summary.edgeAdded > 0"
                type="success"
                :content="`+${versionPreview.summary.edgeAdded} edges`"
              ></goa-badge>
              <goa-badge
                v-if="versionPreview.summary.edgeRemoved > 0"
                type="emergency"
                :content="`−${versionPreview.summary.edgeRemoved} edges`"
              ></goa-badge>
              <goa-badge
                v-if="versionPreview.summary.edgeModified > 0"
                type="important"
                :content="`~${versionPreview.summary.edgeModified} edges`"
              ></goa-badge>
            </div>

            <div
              v-if="versionPreview.diff.addedNodes.length > 0"
              class="border border-[var(--goa-color-border)] rounded p-2"
            >
              <div class="font-semibold text-[var(--goa-color-success-dark, #0d6e3f)] mb-1">
                Nodes to add ({{ versionPreview.diff.addedNodes.length }})
              </div>
              <ul class="space-y-0.5">
                <li v-for="n in versionPreview.diff.addedNodes" :key="`add-${n.id}`" class="truncate">
                  + {{ n.type }}: {{ describeNode(n) }}
                </li>
              </ul>
            </div>

            <div
              v-if="versionPreview.diff.removedNodes.length > 0"
              class="border border-[var(--goa-color-border)] rounded p-2"
            >
              <div class="font-semibold text-[var(--goa-color-error)] mb-1">
                Nodes to remove ({{ versionPreview.diff.removedNodes.length }})
              </div>
              <ul class="space-y-0.5">
                <li v-for="n in versionPreview.diff.removedNodes" :key="`rm-${n.id}`" class="truncate">
                  − {{ n.type }}: {{ describeNode(n) }}
                </li>
              </ul>
            </div>

            <div
              v-if="versionPreview.diff.modifiedNodes.length > 0"
              class="border border-[var(--goa-color-border)] rounded p-2"
            >
              <div class="font-semibold mb-1">
                Nodes to modify ({{ versionPreview.diff.modifiedNodes.length }})
              </div>
              <ul class="space-y-0.5">
                <li v-for="m in versionPreview.diff.modifiedNodes" :key="`mod-${m.id}`" class="truncate">
                  ~ {{ m.after.type }}: {{ describeNode(m.before) }}
                  <span v-if="describeNode(m.before) !== describeNode(m.after)" class="text-[var(--goa-color-text-secondary)]">
                    → {{ describeNode(m.after) }}
                  </span>
                </li>
              </ul>
            </div>

            <div
              v-if="versionPreview.diff.addedEdges.length + versionPreview.diff.removedEdges.length + versionPreview.diff.modifiedEdges.length > 0"
              class="border border-[var(--goa-color-border)] rounded p-2"
            >
              <div class="font-semibold mb-1">Edges</div>
              <ul class="space-y-0.5">
                <li v-for="e in versionPreview.diff.addedEdges" :key="`ae-${e.id}`" class="truncate text-[var(--goa-color-success-dark, #0d6e3f)]">
                  + {{ describeEdge(e) }}
                </li>
                <li v-for="e in versionPreview.diff.removedEdges" :key="`re-${e.id}`" class="truncate text-[var(--goa-color-error)]">
                  − {{ describeEdge(e) }}
                </li>
                <li v-for="m in versionPreview.diff.modifiedEdges" :key="`me-${m.id}`" class="truncate">
                  ~ {{ describeEdge(m.before) }} → {{ describeEdge(m.after) }}
                </li>
              </ul>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <goa-button type="secondary" size="compact" @_click="onClosePreview">
              Cancel
            </goa-button>
            <goa-button
              type="primary"
              size="compact"
              :disabled="restoringVersion !== null || undefined"
              @_click="restoreFromPreview"
            >
              {{ restoringVersion !== null ? 'Restoring…' : 'Restore this version' }}
            </goa-button>
          </div>
        </div>

        <!-- LIST MODE -->
        <ul v-else-if="versions.length > 0" class="divide-y divide-[var(--goa-color-border)]">
          <li
            v-for="v in versions"
            :key="v.version"
            class="px-4 py-3 flex items-start gap-3"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold">v{{ v.version }}</span>
                <goa-badge
                  v-if="currentVersion === v.version"
                  type="information"
                  content="Current"
                ></goa-badge>
              </div>
              <div class="text-xs text-[var(--goa-color-text-secondary)]">
                {{ formatDate(v.createdAt) }}
              </div>
              <div class="text-xs text-[var(--goa-color-text-secondary)] truncate">
                {{ v.createdByDisplayName || v.createdByEmail || v.createdBy }}
              </div>
            </div>
            <div class="flex flex-col gap-1 items-end">
              <goa-button
                type="tertiary"
                size="compact"
                :disabled="currentVersion === v.version || previewLoading || undefined"
                @_click="onPreview(v)"
              >
                Preview
              </goa-button>
              <goa-button
                type="secondary"
                size="compact"
                :disabled="currentVersion === v.version || restoringVersion !== null || undefined"
                @_click="askRestore(v)"
              >
                {{
                  restoringVersion === v.version
                    ? 'Restoring…'
                    : currentVersion === v.version
                    ? 'Active'
                    : 'Restore'
                }}
              </goa-button>
            </div>
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
                <goa-badge :type="statusBadgeType(exec.status)" :content="exec.status"></goa-badge>
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
                      <goa-badge :type="statusBadgeType(stage.status)" :content="stage.status"></goa-badge>
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

      <goa-modal
        v-if="restoreTarget"
        open
        heading="Restore this version?"
        role="alertdialog"
        @_close="restoreTarget = null"
      >
        <p>
          Restore canvas to version <strong>{{ restoreTarget.version }}</strong>?
          This creates a new version on top of the current one.
        </p>
        <div slot="actions" class="flex justify-end gap-2">
          <goa-button type="secondary" @_click="restoreTarget = null">Cancel</goa-button>
          <goa-button type="primary" @_click="confirmRestore">Restore</goa-button>
        </div>
      </goa-modal>
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
