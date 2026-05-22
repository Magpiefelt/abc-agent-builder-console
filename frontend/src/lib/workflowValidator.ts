/**
 * Pure-functional canvas linter.
 *
 * Run this over a workflow's `canvas_data` (and optionally the runtime
 * library that comes back from `/api/workflows/library`) to find structural
 * and per-node issues BEFORE the user clicks Run. Compatible with the
 * backend's `analyzeGraph` on the structural side (same cycle / topo
 * semantics) so the two never disagree about whether a graph is runnable.
 *
 * The validator is intentionally a pure function with no Vue or Pinia
 * dependencies — it backs unit tests, the toolbar popover, and (later) a
 * CLI lint job without modification.
 */

import type {
  AgentNodeData,
  CanvasData,
  CanvasEdge,
  CanvasNode,
  FunctionCatalogEntry,
  FunctionNodeData,
  NodeKind,
  ToolManifestEntry,
  ToolNodeData,
  WorkflowLibrary,
} from '@/types/workflow'

export type IssueSeverity = 'error' | 'warning' | 'info'

export type IssueCode =
  | 'empty_graph'
  | 'duplicate_node_id'
  | 'edge_missing_endpoint'
  | 'cycle'
  | 'orphan_node'
  | 'multiple_entries'
  | 'no_terminal'
  | 'agent_missing_model'
  | 'agent_missing_prompt'
  | 'function_missing_name'
  | 'function_unknown_name'
  | 'function_missing_param'
  | 'tool_missing_name'
  | 'tool_unknown_name'
  | 'tool_missing_param'

export interface ValidationIssue {
  code: IssueCode
  severity: IssueSeverity
  /**
   * The node this issue is attached to. `null` means the issue is graph-wide
   * (empty graph, multiple entries) and clicking it shouldn't try to select a
   * node.
   */
  nodeId: string | null
  /** Human-readable single sentence. Safe to render as-is. */
  message: string
  /** Additional structured context for tests + tooling. */
  details?: Record<string, unknown>
}

export interface ValidationResult {
  issues: ValidationIssue[]
  counts: {
    error: number
    warning: number
    info: number
    total: number
  }
  /** Convenience flag — true when there are zero errors (warnings/info still possible). */
  runnable: boolean
}

/**
 * Validate a canvas. The library is optional: when omitted, the function/tool
 * unknown-name checks are skipped (we don't want to flag every function node
 * as "unknown" just because the library hasn't loaded yet).
 */
export function validateCanvas(
  canvas: CanvasData | null | undefined,
  library?: WorkflowLibrary | null,
): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!canvas) {
    return finalize(issues)
  }

  const nodes = canvas.nodes ?? []
  const edges = canvas.edges ?? []

  // ------------------------------------------------------------------------
  // Structural checks
  // ------------------------------------------------------------------------

  if (nodes.length === 0) {
    issues.push({
      code: 'empty_graph',
      severity: 'error',
      nodeId: null,
      message: 'Workflow has no nodes. Drag a node from the sidebar to begin.',
    })
    return finalize(issues)
  }

  // Duplicate IDs: collect, then flag each duplicate occurrence so users can
  // jump straight to the offending node.
  const seenIds = new Map<string, number>()
  for (const n of nodes) {
    seenIds.set(n.id, (seenIds.get(n.id) ?? 0) + 1)
  }
  for (const [id, count] of seenIds) {
    if (count > 1) {
      issues.push({
        code: 'duplicate_node_id',
        severity: 'error',
        nodeId: id,
        message: `Node id "${id}" is used by ${count} nodes. Each node must have a unique id.`,
        details: { count },
      })
    }
  }

  // Edges that reference missing endpoints. Use a Set for O(1) lookup; an
  // edge with a missing endpoint can't participate in topo so we also skip
  // it from the cycle check below.
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const validEdges: CanvasEdge[] = []
  for (const e of edges) {
    const missingSource = !nodeIdSet.has(e.source)
    const missingTarget = !nodeIdSet.has(e.target)
    if (missingSource || missingTarget) {
      issues.push({
        code: 'edge_missing_endpoint',
        severity: 'error',
        // Attach the issue to whichever endpoint IS present so clicking it
        // takes the user to a real node. If both are missing, fall back to
        // null (graph-wide).
        nodeId: missingSource && missingTarget ? null : (missingSource ? e.target : e.source),
        message: missingSource && missingTarget
          ? `Edge "${e.id}" references missing nodes "${e.source}" → "${e.target}".`
          : missingSource
            ? `Edge "${e.id}" has unknown source "${e.source}".`
            : `Edge "${e.id}" has unknown target "${e.target}".`,
        details: { edgeId: e.id, source: e.source, target: e.target },
      })
    } else {
      validEdges.push(e)
    }
  }

  // Cycle detection (mirrors backend's analyzeGraph). Iterative Kahn's:
  // peel zero-indegree nodes; if any remain, they form a cycle.
  const cycleNodes = detectCycle(nodes, validEdges)
  if (cycleNodes.length > 0) {
    for (const id of cycleNodes) {
      issues.push({
        code: 'cycle',
        severity: 'error',
        nodeId: id,
        message: `Node "${labelFor(nodes, id)}" is part of a cycle. Workflows must be a DAG.`,
      })
    }
  }

  // Reachability + entry/terminal analysis. Compute indegree / outdegree on
  // the valid edges so we don't double-count broken edges.
  const indeg = new Map<string, number>()
  const outdeg = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    indeg.set(n.id, 0)
    outdeg.set(n.id, 0)
    children.set(n.id, [])
  }
  for (const e of validEdges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    outdeg.set(e.source, (outdeg.get(e.source) ?? 0) + 1)
    children.get(e.source)!.push(e.target)
  }

  // Note nodes are decoration and should not be expected to participate in
  // entry/terminal counting. They're allowed to be orphans.
  const executable = nodes.filter((n) => n.data.kind !== 'note')

  const entries = executable.filter((n) => (indeg.get(n.id) ?? 0) === 0)
  if (executable.length > 0 && entries.length > 1) {
    issues.push({
      code: 'multiple_entries',
      severity: 'info',
      nodeId: null,
      message: `Workflow has ${entries.length} entry points. They will execute in parallel.`,
      details: { entryIds: entries.map((n) => n.id) },
    })
  }

  if (executable.length > 0 && executable.every((n) => (outdeg.get(n.id) ?? 0) > 0)) {
    issues.push({
      code: 'no_terminal',
      severity: 'warning',
      nodeId: null,
      message: 'No terminal node — every node has an outgoing edge. Add a sink so the workflow has a clear result.',
    })
  }

  // Orphan: an executable node that has no edges at all (neither incoming nor
  // outgoing) in a graph that *does* contain other connected nodes. A truly
  // single-node workflow is fine; an isolated node alongside a connected
  // pipeline is almost certainly something the user forgot to wire up.
  //
  // We skip this analysis when the graph has cycles — cycle issues take
  // priority and surface the same "the graph isn't a clean DAG" signal more
  // explicitly.
  const hasAnyConnection = validEdges.length > 0
  if (hasAnyConnection && cycleNodes.length === 0) {
    for (const n of executable) {
      const inD = indeg.get(n.id) ?? 0
      const outD = outdeg.get(n.id) ?? 0
      if (inD === 0 && outD === 0) {
        issues.push({
          code: 'orphan_node',
          severity: 'warning',
          nodeId: n.id,
          message: `Node "${labelFor(nodes, n.id)}" has no connections — it will never run.`,
        })
      }
    }
  }

  // ------------------------------------------------------------------------
  // Per-node configuration checks
  // ------------------------------------------------------------------------

  const functionByName = new Map<string, FunctionCatalogEntry>()
  for (const f of library?.functionCatalog ?? []) {
    functionByName.set(f.name, f)
  }
  const toolByName = new Map<string, ToolManifestEntry>()
  for (const t of library?.tools ?? []) {
    toolByName.set(t.name, t)
  }
  const hasLibrary = Boolean(library)

  for (const node of nodes) {
    switch (node.data.kind) {
      case 'agent':
        validateAgentNode(node, node.data, issues)
        break
      case 'function':
        validateFunctionNode(node, node.data, hasLibrary, functionByName, issues)
        break
      case 'tool':
        validateToolNode(node, node.data, hasLibrary, toolByName, issues)
        break
      case 'note':
        // Note nodes are documentation; nothing to validate.
        break
    }
  }

  return finalize(issues)
}

// ===========================================================================
// Per-node validators
// ===========================================================================

function validateAgentNode(
  node: CanvasNode,
  data: AgentNodeData,
  issues: ValidationIssue[],
): void {
  if (!data.modelId || data.modelId.trim() === '') {
    issues.push({
      code: 'agent_missing_model',
      severity: 'error',
      nodeId: node.id,
      message: `Agent node "${data.label || node.id}" has no model selected.`,
    })
  }
  const hasTemplate = Boolean(data.templateId && data.templateId.trim() !== '')
  const hasPrompt = Boolean(
    data.systemPromptOverride && data.systemPromptOverride.trim() !== '',
  )
  if (!hasTemplate && !hasPrompt) {
    issues.push({
      code: 'agent_missing_prompt',
      severity: 'error',
      nodeId: node.id,
      message: `Agent node "${data.label || node.id}" needs either a template or a custom system prompt.`,
    })
  }
}

function validateFunctionNode(
  node: CanvasNode,
  data: FunctionNodeData,
  hasLibrary: boolean,
  catalog: Map<string, FunctionCatalogEntry>,
  issues: ValidationIssue[],
): void {
  const name = (data.fnName || '').trim()
  if (!name) {
    issues.push({
      code: 'function_missing_name',
      severity: 'error',
      nodeId: node.id,
      message: `Function node "${data.label || node.id}" has no function selected.`,
    })
    return
  }
  if (!hasLibrary) {
    // Can't verify against an unloaded catalog. Skip the catalog-dependent
    // checks rather than emit misleading errors.
    return
  }
  const entry = catalog.get(name)
  if (!entry) {
    issues.push({
      code: 'function_unknown_name',
      severity: 'error',
      nodeId: node.id,
      message: `Function "${name}" is not in the catalog. Pick another from the sidebar.`,
      details: { fnName: name },
    })
    return
  }
  const supplied = data.params ?? {}
  for (const param of entry.params) {
    if (!param.required) continue
    if (param.default !== undefined) continue
    const value = supplied[param.name]
    if (isMissingValue(value)) {
      issues.push({
        code: 'function_missing_param',
        severity: 'error',
        nodeId: node.id,
        message: `Function "${name}" needs a value for required parameter "${param.name}".`,
        details: { fnName: name, param: param.name },
      })
    }
  }
}

function validateToolNode(
  node: CanvasNode,
  data: ToolNodeData,
  hasLibrary: boolean,
  manifest: Map<string, ToolManifestEntry>,
  issues: ValidationIssue[],
): void {
  const name = (data.toolName || '').trim()
  if (!name) {
    issues.push({
      code: 'tool_missing_name',
      severity: 'error',
      nodeId: node.id,
      message: `Tool node "${data.label || node.id}" has no tool selected.`,
    })
    return
  }
  if (!hasLibrary) return
  const entry = manifest.get(name)
  if (!entry) {
    issues.push({
      code: 'tool_unknown_name',
      severity: 'error',
      nodeId: node.id,
      message: `Tool "${name}" is not in the manifest. It may have been removed or renamed.`,
      details: { toolName: name },
    })
    return
  }
  const required = entry.parameters?.required ?? []
  const supplied = data.params ?? {}
  const props = (entry.parameters?.properties ?? {}) as Record<string, { default?: unknown }>
  for (const paramName of required) {
    // If the manifest gives a default the executor will fall back to, the
    // user doesn't need to supply a value.
    if (props[paramName] && 'default' in props[paramName]) continue
    if (isMissingValue(supplied[paramName])) {
      issues.push({
        code: 'tool_missing_param',
        severity: 'error',
        nodeId: node.id,
        message: `Tool "${name}" needs a value for required parameter "${paramName}".`,
        details: { toolName: name, param: paramName },
      })
    }
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function detectCycle(nodes: CanvasNode[], edges: CanvasEdge[]): string[] {
  const indeg = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    indeg.set(n.id, 0)
    children.set(n.id, [])
  }
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    children.get(e.source)!.push(e.target)
  }
  const queue: string[] = []
  for (const [id, deg] of indeg) {
    if (deg === 0) queue.push(id)
  }
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    visited.add(id)
    for (const child of children.get(id) ?? []) {
      const next = (indeg.get(child) ?? 0) - 1
      indeg.set(child, next)
      if (next === 0) queue.push(child)
    }
  }
  return nodes.map((n) => n.id).filter((id) => !visited.has(id))
}

function labelFor(nodes: CanvasNode[], id: string): string {
  const n = nodes.find((node) => node.id === id)
  return n?.data?.label?.trim() || id
}

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  let error = 0
  let warning = 0
  let info = 0
  for (const i of issues) {
    if (i.severity === 'error') error++
    else if (i.severity === 'warning') warning++
    else info++
  }
  return {
    issues,
    counts: { error, warning, info, total: issues.length },
    runnable: error === 0,
  }
}

/**
 * Stable label for a node kind — handy for the panel UI so we don't have to
 * repeat the switch elsewhere.
 */
export function kindLabel(kind: NodeKind): string {
  switch (kind) {
    case 'agent': return 'Agent'
    case 'function': return 'Function'
    case 'tool': return 'Tool'
    case 'note': return 'Note'
  }
}
