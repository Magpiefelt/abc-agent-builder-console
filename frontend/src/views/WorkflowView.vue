<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import { useModelsStore } from '@/stores/models'
import { useToast } from '@/composables/useToast'
import { useDocumentTitle } from '@/composables/useDocumentTitle'
import WorkflowCanvas from '@/components/workflow/WorkflowCanvas.vue'
import WorkflowSidebar from '@/components/workflow/WorkflowSidebar.vue'
import PropertiesPanel from '@/components/workflow/PropertiesPanel.vue'
import WorkflowToolbar from '@/components/workflow/WorkflowToolbar.vue'
import WorkflowHistoryPanel from '@/components/workflow/WorkflowHistoryPanel.vue'
import ExecutionPanel from '@/components/workflow/ExecutionPanel.vue'
import type { CanvasNode, Classification, NodeData, NodeKind } from '@/types/workflow'

const route = useRoute()
const router = useRouter()
const store = useWorkflowStore()
const modelsStore = useModelsStore()
const toast = useToast()
const { current, library, dirty, selectedNode, execution, error } = storeToRefs(store)

useDocumentTitle(() => {
  if (!current.value) return 'Workflow'
  const name = current.value.name?.trim() || 'Untitled workflow'
  return dirty.value ? `${name} •` : name
})

const classifications: Classification[] = ['unclassified', 'protected_a', 'protected_b']

const models = computed(() =>
  modelsStore.models.map((m) => ({ id: m.id, name: m.name })),
)

const runError = ref<string | null>(null)
const saveError = ref<string | null>(null)
const historyOpen = ref(false)

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
  try {
    await store.execute()
  } catch (e) {
    runError.value = (e as Error).message
  }
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
        <div class="flex-1 relative bg-gray-50 min-h-0">
          <WorkflowCanvas
            v-if="current"
            :nodes="current.canvas_data.nodes"
            :edges="current.canvas_data.edges"
            :execution-stages="stageMap"
            @update:nodes="onNodesUpdate"
            @update:edges="onEdgesUpdate"
            @select="onSelect"
            @drop-node="onDrop"
          />
          <div
            v-else
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
  </div>
</template>
