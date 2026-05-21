import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  Classification,
  ExecutionState,
  ExecutionStatus,
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
 * and the live execution state during an SSE stream.
 *
 * NOTE: An inline `streamSSE` helper is included until Stream B's
 * `useSSEStream` composable lands. The signature is preserved so the
 * extraction is mechanical.
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
  let executionAbort: AbortController | null = null

  const selectedNode = computed(() => {
    if (!current.value || !selectedNodeId.value) return null
    return current.value.canvas_data.nodes.find((n) => n.id === selectedNodeId.value) ?? null
  })

  // ============================================================================
  // LIBRARY
  // ============================================================================

  async function loadLibrary(): Promise<void> {
    if (library.value) return
    const res = await fetch('/api/workflows/library')
    if (!res.ok) throw new Error(`Failed to load library: ${res.status}`)
    library.value = await res.json()
  }

  // ============================================================================
  // CRUD
  // ============================================================================

  async function loadList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/workflows')
      if (!res.ok) throw new Error(`Failed to list workflows: ${res.status}`)
      const data = await res.json()
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
      const res = await fetch(`/api/workflows/${id}`)
      if (!res.ok) throw new Error(`Failed to load workflow: ${res.status}`)
      current.value = await res.json()
      dirty.value = false
      selectedNodeId.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function create(
    name: string,
    classification: Classification = 'unclassified',
    canvasData?: CanvasData
  ): Promise<Workflow> {
    const canvas: CanvasData = canvasData ?? { nodes: [], edges: [], version: 1 }
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, classification, canvasData: canvas }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to create' }))
      throw new Error(body.error || `Failed to create: ${res.status}`)
    }
    const wf: Workflow = await res.json()
    list.value = [
      {
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
      },
      ...list.value,
    ]
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
    const res = await fetch(`/api/workflows/${current.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Failed to save' }))
      throw new Error(errBody.error || `Failed to save: ${res.status}`)
    }
    current.value = await res.json()
    dirty.value = false
    // Refresh list entry
    if (current.value) {
      const idx = list.value.findIndex((w) => w.id === current.value!.id)
      const summary: WorkflowSummary = {
        id: current.value.id,
        name: current.value.name,
        description: current.value.description,
        classification: current.value.classification,
        version: current.value.version,
        is_template: current.value.is_template,
        ministry_code: current.value.ministry_code,
        user_id: current.value.user_id,
        updated_at: current.value.updated_at,
        created_at: current.value.created_at,
      }
      if (idx >= 0) list.value[idx] = summary
      else list.value = [summary, ...list.value]
    }
  }

  async function duplicate(id: string, newName?: string): Promise<Workflow> {
    const res = await fetch(`/api/workflows/${id}`)
    if (!res.ok) throw new Error(`Failed to load workflow: ${res.status}`)
    const src: Workflow = await res.json()
    return create(newName ?? `${src.name} (copy)`, src.classification, src.canvas_data)
  }

  async function remove(id: string): Promise<void> {
    const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Failed to delete' }))
      throw new Error(errBody.error || `Failed to delete: ${res.status}`)
    }
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

    executionAbort = new AbortController()

    await streamSSE(
      `/api/workflows/${current.value.id}/execute`,
      { continueOnError },
      executionAbort.signal,
      (event) => {
        events.value.push(event)
        applyExecutionEvent(event)
      }
    ).catch((err) => {
      if (execution.value) {
        const aborted = (err as { name?: string }).name === 'AbortError'
        execution.value.status = aborted ? 'aborted' : 'error'
        if (!aborted) execution.value.error = (err as Error).message
        execution.value.completedAt = Date.now()
      }
    }).finally(() => {
      executionAbort = null
    })
  }

  function cancelExecution(): void {
    if (executionAbort) {
      executionAbort.abort()
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

// ============================================================================
// INLINE SSE STREAMER (replace with Stream B's useSSEStream when ready)
// ============================================================================

async function streamSSE(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (e: SSEEvent) => void
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = `Stream failed: ${res.status}`
    try {
      const body = await res.json()
      msg = body.error || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let lineEnd = buffer.indexOf('\n\n')
    while (lineEnd !== -1) {
      const chunk = buffer.slice(0, lineEnd)
      buffer = buffer.slice(lineEnd + 2)

      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6)
          try {
            const parsed = JSON.parse(payload) as SSEEvent
            onEvent(parsed)
          } catch {
            /* ignore malformed events */
          }
        }
        // ': heartbeat' lines are silently ignored
      }

      lineEnd = buffer.indexOf('\n\n')
    }
  }
}
