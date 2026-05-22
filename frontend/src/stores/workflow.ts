import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSSEStream } from '@/composables/useSSEStream'
import { apiFetch } from '@/composables/useApiFetch'
import { diffCanvas, summarizeCanvasDiff, type CanvasDiff, type CanvasDiffSummary } from '@/lib/canvasDiff'
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
  WorkflowCostEstimate,
  WorkflowLibrary,
  WorkflowSummary,
  WorkflowVersionDetail,
  WorkflowVersionListResponse,
  WorkflowVersionSummary,
  WorkflowExecutionDetail,
  WorkflowExecutionListResponse,
  WorkflowExecutionSummary,
} from '@/types/workflow'

export interface VersionPreview {
  version: number
  detail: WorkflowVersionDetail
  diff: CanvasDiff
  summary: CanvasDiffSummary
}

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

  // History side-panel state. `historyKey` is the workflow id the lists below
  // were last fetched for — when it diverges from `current.value.id` the panel
  // refetches.
  const versions = ref<WorkflowVersionSummary[]>([])
  const currentVersion = ref<number | null>(null)
  const executions = ref<WorkflowExecutionSummary[]>([])
  const historyKey = ref<string | null>(null)
  const historyLoading = ref(false)
  const historyError = ref<string | null>(null)

  // Preview of an old version. When non-null the history panel renders the
  // diff against `current` instead of the version list. Restore-from-preview
  // simply forwards to `restoreVersion`.
  const versionPreview = ref<VersionPreview | null>(null)
  const previewLoading = ref(false)
  const previewError = ref<string | null>(null)

  // Cost-estimation state (recommendations §4.3). Populated by `estimate()`
  // before a run so the WorkflowCostDialog can render token + dollar figures
  // without re-fetching.
  const costEstimate = ref<WorkflowCostEstimate | null>(null)
  const estimateLoading = ref(false)
  const estimateError = ref<string | null>(null)

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
      tags: Array.isArray(wf.tags) ? wf.tags : [],
      ministry_code: wf.ministry_code,
      user_id: wf.user_id,
      updated_at: wf.updated_at,
      created_at: wf.created_at,
    }
  }

  async function create(
    name: string,
    classification: Classification = 'unclassified',
    canvasData?: CanvasData,
    tags?: string[],
  ): Promise<Workflow> {
    const canvas: CanvasData = canvasData ?? { nodes: [], edges: [], version: 1 }
    const body: Record<string, unknown> = { name, classification, canvasData: canvas }
    if (tags !== undefined) body.tags = tags
    const wf = await apiFetch<Workflow>('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
      tags: current.value.tags ?? [],
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
    return create(
      newName ?? `${src.name} (copy)`,
      src.classification,
      src.canvas_data,
      Array.isArray(src.tags) ? src.tags : [],
    )
  }

  async function remove(id: string): Promise<void> {
    await apiFetch(`/api/workflows/${id}`, { method: 'DELETE' })
    list.value = list.value.filter((w) => w.id !== id)
    if (current.value?.id === id) current.value = null
  }

  // ============================================================================
  // PORTABLE JSON EXPORT / IMPORT
  // ============================================================================
  //
  // Workflows can be exported as a portable .json bundle and imported back to
  // create a new workflow. The export contains only the fields that are part
  // of the canvas contract — never database identifiers, ministry scoping, or
  // audit metadata. Import never overwrites an existing workflow; it always
  // creates a fresh one so audit/ministry attribution stays correct.

  interface WorkflowExport {
    schemaVersion: 1
    exportedAt: string
    name: string
    description: string | null
    classification: Classification
    canvas_data: CanvasData
  }

  function buildExport(): WorkflowExport | null {
    if (!current.value) return null
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      name: current.value.name,
      description: current.value.description ?? null,
      classification: current.value.classification,
      canvas_data: current.value.canvas_data,
    }
  }

  function safeFilename(name: string): string {
    const trimmed = name.trim() || 'workflow'
    return trimmed.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  }

  function exportToFile(): void {
    const bundle = buildExport()
    if (!bundle) return
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFilename(bundle.name)}.workflow.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function parseImport(raw: string): WorkflowExport {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Not a valid JSON file.')
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('Workflow file is empty or malformed.')
    const obj = parsed as Record<string, unknown>
    if (obj.schemaVersion !== 1) {
      throw new Error(`Unsupported export schema (expected version 1, got ${String(obj.schemaVersion)}).`)
    }
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      throw new Error('Workflow file is missing a name.')
    }
    const classifications: Classification[] = ['unclassified', 'protected_a', 'protected_b']
    if (!classifications.includes(obj.classification as Classification)) {
      throw new Error('Workflow file has an invalid classification.')
    }
    const canvas = obj.canvas_data as Record<string, unknown> | undefined
    if (!canvas || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
      throw new Error('Workflow file is missing canvas_data.nodes or canvas_data.edges.')
    }
    return {
      schemaVersion: 1,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      name: obj.name,
      description: typeof obj.description === 'string' ? obj.description : null,
      classification: obj.classification as Classification,
      canvas_data: {
        nodes: canvas.nodes as CanvasNode[],
        edges: canvas.edges as CanvasEdge[],
        version: 1,
      },
    }
  }

  async function importFromFile(file: File): Promise<Workflow> {
    const text = await file.text()
    const bundle = parseImport(text)
    return create(bundle.name, bundle.classification, bundle.canvas_data)
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

  /**
   * Replace the workflow's tag list. Bot 17 (F5). The store accepts the
   * already-normalised list (lowercased, deduped, trimmed) from the
   * WorkflowTagsEditor; the route normalises again on save so a hand-crafted
   * PUT can't bypass the rules. Skips the dirty flip when the new list is
   * identical to the existing one — avoids spurious "unsaved changes" prompts
   * when the editor commits without an actual change.
   */
  function setTags(tags: string[]): void {
    if (!current.value) return
    const prev = current.value.tags ?? []
    if (prev.length === tags.length && prev.every((t, i) => t === tags[i])) {
      // No-op; preserve dirty state.
      current.value.tags = tags
      return
    }
    current.value.tags = tags
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

  async function execute(
    optionsOrLegacy: { continueOnError?: boolean; dryRun?: boolean } | boolean = {},
  ): Promise<void> {
    if (!current.value) return
    if (execution.value?.status === 'running') return

    // Backwards-compatible signature: original callers passed a single boolean.
    const opts =
      typeof optionsOrLegacy === 'boolean'
        ? { continueOnError: optionsOrLegacy }
        : optionsOrLegacy
    const continueOnError = !!opts.continueOnError
    const dryRun = !!opts.dryRun

    const stages = new Map<string, StageState>()
    for (const node of current.value.canvas_data.nodes) {
      stages.set(node.id, newStageState(node.id, node.type))
    }

    execution.value = {
      id: '',
      status: 'running',
      stages,
      startedAt: Date.now(),
      piiBlockedTotal: 0,
      dryRun,
    }
    events.value = []

    await sseStream.start(`/api/workflows/${current.value.id}/execute`, {
      body: { continueOnError, dryRun },
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
        // Honor the server's authoritative dryRun flag. The store already
        // set this from the request options, but mirroring the server value
        // means a future replay or out-of-band event source still produces
        // the right UI banner.
        if (typeof event.dryRun === 'boolean') {
          execution.value.dryRun = event.dryRun
        }
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
          s.tokens = event.tokens
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
      case 'pii_warning': {
        const s = execution.value.stages.get(event.nodeId)
        if (s) {
          s.piiBlockedCount = (s.piiBlockedCount ?? 0) + event.blockedCount
        }
        execution.value.piiBlockedTotal += event.blockedCount
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

  // ============================================================================
  // COST ESTIMATION (recommendations §4.3)
  // ============================================================================
  //
  // Sends the current in-memory canvas (including unsaved edits) to the backend
  // estimator and stashes the result for the pre-run confirmation dialog.

  async function estimate(): Promise<WorkflowCostEstimate | null> {
    if (!current.value) return null
    estimateLoading.value = true
    estimateError.value = null
    try {
      const result = await apiFetch<WorkflowCostEstimate>(
        `/api/workflows/${encodeURIComponent(current.value.id)}/estimate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvasData: current.value.canvas_data }),
        },
      )
      costEstimate.value = result
      return result
    } catch (e) {
      estimateError.value = (e as Error).message
      throw e
    } finally {
      estimateLoading.value = false
    }
  }

  function clearEstimate(): void {
    costEstimate.value = null
    estimateError.value = null
  }

  // ============================================================================
  // HISTORY (versions + executions)
  // ============================================================================

  async function loadHistory(workflowId: string): Promise<void> {
    historyLoading.value = true
    historyError.value = null
    try {
      const [v, e] = await Promise.all([
        apiFetch<WorkflowVersionListResponse>(
          `/api/workflows/${encodeURIComponent(workflowId)}/versions`,
        ),
        apiFetch<WorkflowExecutionListResponse>(
          `/api/workflows/${encodeURIComponent(workflowId)}/executions?limit=50`,
        ),
      ])
      versions.value = v.versions
      currentVersion.value = v.currentVersion
      executions.value = e.executions
      historyKey.value = workflowId
    } catch (err) {
      historyError.value = (err as Error).message
    } finally {
      historyLoading.value = false
    }
  }

  async function loadVersionCanvas(
    workflowId: string,
    version: number,
  ): Promise<WorkflowVersionDetail> {
    return apiFetch<WorkflowVersionDetail>(
      `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}`,
    )
  }

  async function previewVersion(version: number): Promise<VersionPreview | null> {
    if (!current.value) return null
    previewLoading.value = true
    previewError.value = null
    try {
      const detail = await loadVersionCanvas(current.value.id, version)
      const diff = diffCanvas(current.value.canvas_data, detail.canvasData)
      const summary = summarizeCanvasDiff(diff)
      const preview: VersionPreview = { version, detail, diff, summary }
      versionPreview.value = preview
      return preview
    } catch (err) {
      previewError.value = (err as Error).message
      versionPreview.value = null
      return null
    } finally {
      previewLoading.value = false
    }
  }

  function clearVersionPreview(): void {
    versionPreview.value = null
    previewError.value = null
    previewLoading.value = false
  }

  async function restoreVersion(version: number): Promise<void> {
    if (!current.value) return
    const id = current.value.id
    const refreshed = await apiFetch<Workflow>(
      `/api/workflows/${encodeURIComponent(id)}/versions/${version}/restore`,
      { method: 'POST' },
    )
    current.value = refreshed
    dirty.value = false
    const idx = list.value.findIndex((w) => w.id === id)
    const summary = summarize(refreshed)
    if (idx >= 0) list.value[idx] = summary
    // Discard any open preview; the canvas now matches it.
    clearVersionPreview()
    // Refresh history so the new snapshot row appears immediately.
    await loadHistory(id)
  }

  async function loadExecutionDetail(
    workflowId: string,
    executionId: string,
  ): Promise<WorkflowExecutionDetail> {
    return apiFetch<WorkflowExecutionDetail>(
      `/api/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}`,
    )
  }

  function clearHistory(): void {
    versions.value = []
    executions.value = []
    currentVersion.value = null
    historyKey.value = null
    historyError.value = null
    clearVersionPreview()
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
    exportToFile,
    importFromFile,
    setNodes,
    setEdges,
    addNode,
    updateNodeData,
    removeNode,
    setClassification,
    setName,
    setTags,
    select,
    execute,
    cancelExecution,
    clearExecution,
    costEstimate,
    estimateLoading,
    estimateError,
    estimate,
    clearEstimate,
    versions,
    currentVersion,
    executions,
    historyKey,
    historyLoading,
    historyError,
    versionPreview,
    previewLoading,
    previewError,
    loadHistory,
    loadVersionCanvas,
    previewVersion,
    clearVersionPreview,
    restoreVersion,
    loadExecutionDetail,
    clearHistory,
  }
})

