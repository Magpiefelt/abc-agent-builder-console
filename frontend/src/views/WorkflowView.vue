<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import WorkflowCanvas from '@/components/workflow/WorkflowCanvas.vue'
import WorkflowSidebar from '@/components/workflow/WorkflowSidebar.vue'
import PropertiesPanel from '@/components/workflow/PropertiesPanel.vue'
import WorkflowToolbar from '@/components/workflow/WorkflowToolbar.vue'
import type { CanvasNode, Classification, NodeData, NodeKind } from '@/types/workflow'

const route = useRoute()
const router = useRouter()
const store = useWorkflowStore()
const { current, library, dirty, selectedNode, execution, error } = storeToRefs(store)

const classifications: Classification[] = ['unclassified', 'protected_a', 'protected_b']
const models = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
]

const runError = ref<string | null>(null)
const saveError = ref<string | null>(null)

onMounted(async () => {
  const id = route.params.id as string
  await Promise.all([store.loadLibrary(), store.load(id)])
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
  saveError.value = null
  try {
    await store.save()
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

function onBack(): void {
  router.push('/workflows')
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}

onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))

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
    />

    <div
      v-if="saveError || runError || error"
      class="px-4 py-2 bg-[var(--goa-color-error)]/10 border-b border-[var(--goa-color-error)] text-sm text-[var(--goa-color-error)]"
      role="alert"
    >
      {{ saveError || runError || error }}
    </div>

    <div class="flex-1 flex overflow-hidden">
      <WorkflowSidebar
        v-if="library"
        :agent-templates="library.agentTemplates"
        :function-catalog="library.functionCatalog"
        :tools="library.tools"
      />

      <div class="flex-1 relative bg-gray-50">
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
    </div>
  </div>
</template>
