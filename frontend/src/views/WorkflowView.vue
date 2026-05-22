<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import { useModelsStore } from '@/stores/models'
import { useToast } from '@/composables/useToast'
import { useDocumentTitle } from '@/composables/useDocumentTitle'
import WorkflowCanvas, { type CanvasDiffOverlay } from '@/components/workflow/WorkflowCanvas.vue'
import WorkflowSidebar from '@/components/workflow/WorkflowSidebar.vue'
import PropertiesPanel from '@/components/workflow/PropertiesPanel.vue'
import WorkflowToolbar from '@/components/workflow/WorkflowToolbar.vue'
import WorkflowHistoryPanel from '@/components/workflow/WorkflowHistoryPanel.vue'
import ExecutionPanel from '@/components/workflow/ExecutionPanel.vue'
import WorkflowCostDialog from '@/components/workflow/WorkflowCostDialog.vue'
import type { CanvasNode, Classification, NodeData, NodeKind } from '@/types/workflow'

const route = useRoute()
const router = useRouter()
const store = useWorkflowStore()
const modelsStore = useModelsStore()
const toast = useToast()
const {
  current,
  library,
  dirty,
  selectedNode,
  execution,
  error,
  costEstimate,
  estimateLoading,
  estimateError,
  versionPreview,
} = storeToRefs(store)

useDocumentTitle(() => {
  if (!current.value) return 'Workflow'
  const name = current.value.name?.trim() || 'Untitled workflow'
  return dirty.value ? `${name} •` : name
})

const classifications: Classification[] = ['unclassified', 'protected_a', 'protected_b']
// Pull from the registry so new approved models appear in both Free Agent and
// Workflow modes automatically; fall back to the four known models if the
// registry call is still loading so the dropdowns aren't empty on first paint.
const FALLBACK_MODELS: { id: string; name: string }[] = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
]
const models = computed(() =>
  modelsStore.models.length > 0
    ? modelsStore.models.map((m) => ({ id: m.id, name: m.name }))
    : FALLBACK_MODELS,
)

const runError = ref<string | null>(null)
const saveError = ref<string | null>(null)
const historyOpen = ref(false)
const costDialogOpen = ref(false)

function toggleHistory(): void {
  historyOpen.value = !historyOpen.value
}

onMounted(async () => {
  const id = route.params.id as string
  await Promise.all([store.loadLibrary(), store.load(id), modelsStore.ensureLoaded()])
})

watch(() => route.params.id, async (newId) => {
  if (typeof newId === 'string') {
    await store.load(newId)
  }
})

const executionStatus = computed(() => execution.value?.status ?? 'idle')

const stageMap = computed(() => {
  const m = new Map<string, { status: string }>()
  if (!execution.value) return m
  for (const [k, v] of execution.value.stages) {
    m.set(k, { status: v.status })
  }
  return m
})

// F1 — Canvas diff overlay. When a version preview is active, the diff
// already lives in the store; we just rebuild it as the shape WorkflowCanvas
// wants (Sets for fast lookups, plus the raw added* lists for ghost
// rendering). Nothing recomputed: this is a cheap shape adapter.
const diffOverlay = computed<CanvasDiffOverlay | null>(() => {
  const preview = versionPreview.value
  if (!preview) return null
  return {
    removedNodeIds: new Set(preview.diff.removedNodes.map((n) => n.id)),
    modifiedNodeIds: new Set(preview.diff.modifiedNodes.map((m) => m.id)),
    addedNodes: preview.diff.addedNodes,
    removedEdgeIds: new Set(preview.diff.removedEdges.map((e) => e.id)),
    modifiedEdgeIds: new Set(preview.diff.modifiedEdges.map((m) => m.id)),
    addedEdges: preview.diff.addedEdges,
  }
})

async function onRestorePreview(): Promise<void> {
  const preview = versionPreview.value
  if (!preview) return
  try {
    await store.restoreVersion(preview.version)
    toast.push({ kind: 'success', message: `Restored version ${preview.version}.` })
  } catch (e) {
    toast.push({ kind: 'error', message: `Couldn't restore: ${(e as Error).message}` })
  }
}

function onCancelPreview(): void {
  store.clearVersionPreview()
}

function onNodesUpdate(nodes: CanvasNode[]): void {
  store.setNodes(nodes)
  // Sync selection if selected node was removed
  if (store.selectedNodeId && !nodes.find((n) => n.id === store.selectedNodeId)) {
    store.select(null)
  }
}

function onEdgesUpdate(edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }[]): void {
  store.setEdges(edges)
}

function onSelect(id: string | null): void {
  store.select(id)
}

function onDrop(payload: { kind: NodeKind; defaults: Partial<NodeData>; position: { x: number; y: number } }): void {
  const id = `${payload.kind}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`
  const data = { ...payload.defaults, kind: payload.kind } as NodeData
  if (!data.label) data.label = payload.kind
  store.addNode({
    id,
    type: payload.kind,
    position: payload.position,
    data,
  })
  store.select(id)
}

function onPropertyUpdate(patch: Partial<NodeData>): void {
  if (!store.selectedNodeId) return
  store.updateNodeData(store.selectedNodeId, patch)
}

function onPropertyRemove(): void {
  if (!store.selectedNodeId) return
  store.removeNode(store.selectedNodeId)
}

async function onSave(): Promise<void> {
  if (!dirty.value || !current.value) return
  saveError.value = null
  try {
    await store.save()
    toast.push({ kind: 'success', message: 'Workflow saved.' })
  } catch (e) {
    saveError.value = (e as Error).message
  }
}

async function onRun(): Promise<void> {
  runError.value = null
  // Open the dialog optimistically so the user sees the "Estimating…" state
  // even on slow networks; the dialog renders the error if estimate() throws.
  costDialogOpen.value = true
  try {
    await store.estimate()
  } catch {
    // estimateError is surfaced inside the dialog; nothing else to do here.
  }
}

async function onConfirmRun(): Promise<void> {
  costDialogOpen.value = false
  runError.value = null
  try {
    await store.execute()
  } catch (e) {
    runError.value = (e as Error).message
  }
}

async function onDryRun(): Promise<void> {
  // Dry-run skips the cost dialog — there is no real cost to confirm. The
  // ExecutionPanel banner makes the dry-run nature visible to the user from
  // the first SSE event.
  runError.value = null
  toast.push({ kind: 'info', message: 'Dry-running workflow — no tokens will be spent.' })
  try {
    await store.execute({ dryRun: true })
  } catch (e) {
    runError.value = (e as Error).message
  }
}

function onCancelRun(): void {
  costDialogOpen.value = false
  store.clearEstimate()
}

function onKeydown(event: KeyboardEvent): void {
  const mod = event.metaKey || event.ctrlKey
  if (!mod) return
  // Cmd/Ctrl+S — save.
  if (event.key === 's' || event.key === 'S') {
    event.preventDefault()
    if (dirty.value) void onSave()
    return
  }
  // Cmd/Ctrl+Enter — run (only when not already running and clean).
  if (event.key === 'Enter') {
    const status = execution.value?.status
    if (status === 'running') return
    if (dirty.value) {
      toast.push({ kind: 'warning', message: 'Save your changes before running.' })
      return
    }
    event.preventDefault()
    void onRun()
  }
}

function onBack(): void {
  router.push('/workflows')
}

function onExport(): void {
  try {
    store.exportToFile()
    toast.push({ kind: 'success', message: 'Workflow exported.' })
  } catch (e) {
    toast.push({ kind: 'error', message: `Couldn't export: ${(e as Error).message}` })
  }
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('keydown', onKeydown)
})

onBeforeRouteLeave((_to, _from, next) => {
  if (dirty.value && !window.confirm('You have unsaved changes. Leave anyway?')) {
    next(false)
  } else {
    next()
  }
})
</script>

<template>
  <div class="h-full flex flex-col" aria-label="Workflow canvas">
    <WorkflowToolbar
      v-if="current"
      :workflow="current"
      :dirty="dirty"
      :execution-status="executionStatus"
      :classifications="classifications"
      :models="models"
      @save="onSave"
      @run="onRun"
      @dry-run="onDryRun"
      @stop="store.cancelExecution"
      @update:classification="store.setClassification"
      @update:name="store.setName"
      @back="onBack"
      @toggle-history="toggleHistory"
      @export="onExport"
    />

    <goa-callout
      v-if="saveError || runError || error"
      type="emergency"
      heading="Workflow error"
      class="mx-4 mt-2"
    >
      {{ saveError || runError || error }}
    </goa-callout>

    <div class="flex-1 flex overflow-hidden relative">
      <WorkflowSidebar
        v-if="library"
        :agent-templates="library.agentTemplates"
        :function-catalog="library.functionCatalog"
        :tools="library.tools"
      />

      <div class="flex-1 flex flex-col min-w-0">
        <div class="flex-1 relative bg-[var(--goa-color-background)] min-h-0">
          <WorkflowCanvas
            v-if="current"
            :nodes="current.canvas_data.nodes"
            :edges="current.canvas_data.edges"
            :execution-stages="stageMap"
            :diff-overlay="diffOverlay"
            @update:nodes="onNodesUpdate"
            @update:edges="onEdgesUpdate"
            @select="onSelect"
            @drop-node="onDrop"
          />
          <div
            v-if="versionPreview"
            class="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-[var(--goa-color-surface)] border border-[var(--goa-color-warning)] rounded shadow-md text-sm"
            role="status"
            aria-live="polite"
            data-testid="diff-preview-banner"
          >
            <goa-icon type="information-circle" theme="outline"></goa-icon>
            <span>
              Previewing v{{ versionPreview.version }} — Restore to apply the highlighted changes.
            </span>
            <goa-button
              type="primary"
              size="compact"
              :disabled="!versionPreview.summary.hasChanges || undefined"
              @_click="onRestorePreview"
            >
              Restore
            </goa-button>
            <goa-button type="tertiary" size="compact" @_click="onCancelPreview">
              Cancel
            </goa-button>
          </div>
          <div
            v-else-if="!current"
            class="absolute inset-0 flex items-center justify-center text-[var(--goa-color-text-secondary)]"
            role="status"
            aria-live="polite"
          >
            Loading workflow…
          </div>
        </div>
        <ExecutionPanel
          v-if="execution"
          class="max-h-[45%] shrink-0"
        />
      </div>

      <PropertiesPanel
        v-if="library"
        :node="selectedNode"
        :agent-templates="library.agentTemplates"
        :function-catalog="library.functionCatalog"
        :tools="library.tools"
        :models="models"
        @update:node="onPropertyUpdate"
        @remove="onPropertyRemove"
      />

      <WorkflowHistoryPanel
        v-if="current"
        :open="historyOpen"
        :workflow-id="current.id"
        @close="historyOpen = false"
      />
    </div>

    <WorkflowCostDialog
      v-if="costDialogOpen"
      :estimate="costEstimate"
      :loading="estimateLoading"
      :error="estimateError"
      @confirm="onConfirmRun"
      @cancel="onCancelRun"
    />
  </div>
</template>
