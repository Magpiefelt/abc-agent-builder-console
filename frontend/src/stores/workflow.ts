import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSSEStream } from '@/composables/useSSEStream'
import { apiFetch } from '@/composables/useApiFetch'
import type {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  Classification,
  ExecutionState,
  NodeData,
  NodeKind,
  SSEEvent,
  StageState,
  Workflow,
  WorkflowLibrary,
  WorkflowSummary,
} from '@/types/workflow'

/**
 * Workflow store (Stream C).
 *
 * Manages the loaded canvas, the list of saved workflows, the dirty flag,
 * and the live execution state during an SSE stream. Uses Stream A's
 * `apiFetch` for credentialed JSON requests and Stream B's `useSSEStream`
 * for the execute endpoint.
 */
export const useWorkflowStore = defineStore('workflow', () => {
  const list = ref<WorkflowSummary[]>([])
  const current = ref<Workflow | null>(null)
  const library = ref<WorkflowLibrary | null>(null)
  const dirty = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const execution = ref<ExecutionState | null>(null)
  const events = ref<SSEEvent[]>([])
  const selectedNodeId = ref<string | null>(null)

  // Stream B's reusable SSE consumer. We instantiate once per store; the
  // composable handles abort + reconnect + line-buffer parsing.
  const sseStream = useSSEStream<SSEEvent>({
    onEvent: (event) => {
      events.value.push(event)
      applyExecutionEvent(event)
    },
    onError: (err) => {
      if (execution.value && execution.value.status === 'running') {
        execution.value.status = 'error'
        execution.value.error = err.message
        execution.value.completedAt = Date.now()
      }
    },
    onDone: () => {
      if (execution.value && execution.value.status === 'running') {
        // Stream closed without an explicit workflow_complete (e.g. server-side
        // abort). Treat as completed; the audit row reflects the real status.
        execution.value.status = 'completed'
        execution.value.completedAt = Date.now()
      }
    },
  })

  const selectedNode = computed(() => {
    if (!current.value || !selectedNodeId.value) return null
    return current.value.canvas_data.nodes.find((n) => n.id === selectedNodeId.value) ?? null
  })

  // ============================================================================
  // LIBRARY
  // ============================================================================

  async function loadLibrary(): Promise<void> {
    if (library.value) return
    library.value = await apiFetch<WorkflowLibrary>('/api/workflows/library')
  }

  // ============================================================================
  // CRUD
  // ============================================================================

  async function loadList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await apiFetch<{ workflows: WorkflowSummary[] }>('/api/workflows')
      list.value = data.workflows
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function load(id: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      current.value = await apiFetch<Workflow>(`/api/workflows/${id}`)
      dirty.value = false
      selectedNodeId.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  function summarize(wf: Workflow): WorkflowSummary {
    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      classification: wf.classification,
      version: wf.version,
      is_template: wf.is_template,
      ministry_code: wf.ministry_code,
      user_id: wf.user_id,
      updated_at: wf.updated_at,
      created_at: wf.created_at,
    }
  }

  async function create(
    name: string,
    classification: Classification = 'unclassified',
    canvasData?: CanvasData
  ): Promise<Workflow> {
    const canvas: CanvasData = canvasData ?? { nodes: [], edges: [], version: 1 }
    const wf = await apiFetch<Workflow>('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, classification, canvasData: canvas }),
    })
    list.value = [summarize(wf), ...list.value]
    return wf
  }

  async function save(): Promise<void> {
    if (!current.value) return
    const body = {
      name: current.value.name,
      description: current.value.description,
      classification: current.value.classification,
      canvasData: current.value.canvas_data,
    }
    current.value = await apiFetch<Workflow>(`/api/workflows/${current.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    dirty.value = false
    if (current.value) {
      const idx = list.value.findIndex((w) => w.id === current.value!.id)
      const summary = summarize(current.value)
      if (idx >= 0) list.value[idx] = summary
      else list.value = [summary, ...list.value]
    }
  }

  async function duplicate(id: string, newName?: string): Promise<Workflow> {
    const src = await apiFetch<Workflow>(`/api/workflows/${id}`)
    return create(newName ?? `${src.name} (copy)`, src.classification, src.canvas_data)
  }

  async function remove(id: string): Promise<void> {
    await apiFetch(`/api/workflows/${id}`, { method: 'DELETE' })
    list.value = list.value.filter((w) => w.id !== id)
    if (current.value?.id === id) current.value = null
  }

  // ============================================================================
  // CANVAS MUTATIONS
  // ============================================================================

  function setNodes(nodes: CanvasNode[]): void {
    if (!current.value) return
    current.value.canvas_data = { ...current.value.canvas_data, nodes }
    dirty.value = true
  }

  function setEdges(edges: CanvasEdge[]): void {
    if (!current.value) return
    current.value.canvas_data = { ...current.value.canvas_data, edges }
    dirty.value = true
  }

  function addNode(node: CanvasNode): void {
    if (!current.value) return
    current.value.canvas_data = {
      ...current.value.canvas_data,
      nodes: [...current.value.canvas_data.nodes, node],
    }
    dirty.value = true
  }

  function updateNodeData(id: string, patch: Partial<NodeData>): void {
    if (!current.value) return
    const nodes = current.value.canvas_data.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...patch } as NodeData } : n
    )
    current.value.canvas_data = { ...current.value.canvas_data, nodes }
    dirty.value = true
  }

  function removeNode(id: string): void {
    if (!current.value) return
    current.value.canvas_data = {
      nodes: current.value.canvas_data.nodes.filter((n) => n.id !== id),
      edges: current.value.canvas_data.edges.filter((e) => e.source !== id && e.target !== id),
      version: 1,
    }
    if (selectedNodeId.value === id) selectedNodeId.value = null
    dirty.value = true
  }

  function setClassification(c: Classification): void {
    if (!current.value) return
    current.value.classification = c
    dirty.value = true
  }

  function setName(name: string): void {
    if (!current.value) return
    current.value.name = name
    dirty.value = true
  }

  function select(id: string | null): void {
    selectedNodeId.value = id
  }

  // ============================================================================
  // EXECUTION (SSE)
  // ============================================================================

  function newStageState(nodeId: string, kind: NodeKind): StageState {
    return { nodeId, kind, status: 'pending' }
  }

  async function execute(continueOnError = false): Promise<void> {
    if (!current.value) return
    if (execution.value?.status === 'running') return

    const stages = new Map<string, StageState>()
    for (const node of current.value.canvas_data.nodes) {
      stages.set(node.id, newStageState(node.id, node.type))
    }

    execution.value = {
      id: '',
      status: 'running',
      stages,
      startedAt: Date.now(),
    }
    events.value = []

    await sseStream.start(`/api/workflows/${current.value.id}/execute`, {
      body: { continueOnError },
    })
  }

  function cancelExecution(): void {
    sseStream.abort()
    if (execution.value && execution.value.status === 'running') {
      execution.value.status = 'aborted'
      execution.value.completedAt = Date.now()
    }
  }

  function applyExecutionEvent(event: SSEEvent): void {
    if (!execution.value) return
    switch (event.type) {
      case 'workflow_start':
        execution.value.id = event.executionId
        break
      case 'stage_start': {
        const s = execution.value.stages.get(event.nodeId)
        if (s) {
          s.status = 'running'
          s.stageIndex = event.stageIndex
          s.startedAt = Date.now()
        }
        break
      }
      case 'stage_complete': {
        const s = execution.value.stages.get(event.nodeId)
        if (s) {
          s.status = 'completed'
          s.durationMs = event.durationMs
          s.value = event.value
        }
        break
      }
      case 'stage_skipped': {
        const s = execution.value.stages.get(event.nodeId)
        if (s) {
          s.status = 'skipped'
          s.reason = event.reason
        }
        break
      }
      case 'stage_error': {
        const s = execution.value.stages.get(event.nodeId)
        if (s) {
          s.status = 'error'
          s.error = event.error
        }
        break
      }
      case 'workflow_complete':
        execution.value.status = event.status
        execution.value.completedAt = Date.now()
        if (event.error) execution.value.error = event.error
        break
      case 'error':
        execution.value.status = 'error'
        execution.value.error = event.error
        execution.value.completedAt = Date.now()
        break
    }
  }

  function clearExecution(): void {
    execution.value = null
    events.value = []
  }

  return {
    list,
    current,
    library,
    dirty,
    loading,
    error,
    execution,
    events,
    selectedNodeId,
    selectedNode,
    loadLibrary,
    loadList,
    load,
    create,
    duplicate,
    save,
    remove,
    setNodes,
    setEdges,
    addNode,
    updateNodeData,
    removeNode,
    setClassification,
    setName,
    select,
    execute,
    cancelExecution,
    clearExecution,
  }
})

