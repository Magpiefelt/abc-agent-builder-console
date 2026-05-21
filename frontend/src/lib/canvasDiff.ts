/**
 * Compute the structural difference between two workflow canvases.
 *
 * Used by the History panel to preview what a restore would change before the
 * user commits. Pure function — no Vue or store dependencies — so the same
 * helper can back unit tests, the preview UI, and (later) a workflow audit
 * export.
 *
 * Diff semantics:
 *   - A node is "added" if its id is in `target` but not in `source`.
 *   - A node is "removed" if its id is in `source` but not in `target`.
 *   - A node is "modified" if its id exists in both but its `position` or
 *     `data` differ by deep equality.
 *   - Edges follow the same id-based rule. A modification compares
 *     source/target/sourceHandle/targetHandle/label.
 *   - Nodes whose only change is a numerically-trivial position drift (< 1px)
 *     are still flagged — callers can suppress that themselves if needed.
 */

import type { CanvasData, CanvasEdge, CanvasNode } from '@/types/workflow'

export interface NodeModification {
  id: string
  before: CanvasNode
  after: CanvasNode
}

export interface EdgeModification {
  id: string
  before: CanvasEdge
  after: CanvasEdge
}

export interface CanvasDiff {
  addedNodes: CanvasNode[]
  removedNodes: CanvasNode[]
  modifiedNodes: NodeModification[]
  unchangedNodeCount: number
  addedEdges: CanvasEdge[]
  removedEdges: CanvasEdge[]
  modifiedEdges: EdgeModification[]
  unchangedEdgeCount: number
}

export interface CanvasDiffSummary {
  nodeAdded: number
  nodeRemoved: number
  nodeModified: number
  nodeUnchanged: number
  edgeAdded: number
  edgeRemoved: number
  edgeModified: number
  edgeUnchanged: number
  hasChanges: boolean
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function nodeShape(n: CanvasNode): { position: CanvasNode['position']; data: CanvasNode['data'] } {
  return { position: n.position, data: n.data }
}

function edgeShape(e: CanvasEdge): Omit<CanvasEdge, 'id'> {
  return {
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label,
  }
}

export function diffCanvas(source: CanvasData, target: CanvasData): CanvasDiff {
  const sourceNodes = new Map<string, CanvasNode>()
  for (const n of source.nodes) sourceNodes.set(n.id, n)
  const targetNodes = new Map<string, CanvasNode>()
  for (const n of target.nodes) targetNodes.set(n.id, n)

  const addedNodes: CanvasNode[] = []
  const removedNodes: CanvasNode[] = []
  const modifiedNodes: NodeModification[] = []
  let unchangedNodeCount = 0

  for (const [id, node] of targetNodes) {
    const prev = sourceNodes.get(id)
    if (!prev) {
      addedNodes.push(node)
    } else if (!deepEqual(nodeShape(prev), nodeShape(node))) {
      modifiedNodes.push({ id, before: prev, after: node })
    } else {
      unchangedNodeCount++
    }
  }
  for (const [id, node] of sourceNodes) {
    if (!targetNodes.has(id)) removedNodes.push(node)
  }

  const sourceEdges = new Map<string, CanvasEdge>()
  for (const e of source.edges) sourceEdges.set(e.id, e)
  const targetEdges = new Map<string, CanvasEdge>()
  for (const e of target.edges) targetEdges.set(e.id, e)

  const addedEdges: CanvasEdge[] = []
  const removedEdges: CanvasEdge[] = []
  const modifiedEdges: EdgeModification[] = []
  let unchangedEdgeCount = 0

  for (const [id, edge] of targetEdges) {
    const prev = sourceEdges.get(id)
    if (!prev) {
      addedEdges.push(edge)
    } else if (!deepEqual(edgeShape(prev), edgeShape(edge))) {
      modifiedEdges.push({ id, before: prev, after: edge })
    } else {
      unchangedEdgeCount++
    }
  }
  for (const [id, edge] of sourceEdges) {
    if (!targetEdges.has(id)) removedEdges.push(edge)
  }

  return {
    addedNodes,
    removedNodes,
    modifiedNodes,
    unchangedNodeCount,
    addedEdges,
    removedEdges,
    modifiedEdges,
    unchangedEdgeCount,
  }
}

export function summarizeCanvasDiff(diff: CanvasDiff): CanvasDiffSummary {
  const summary: CanvasDiffSummary = {
    nodeAdded: diff.addedNodes.length,
    nodeRemoved: diff.removedNodes.length,
    nodeModified: diff.modifiedNodes.length,
    nodeUnchanged: diff.unchangedNodeCount,
    edgeAdded: diff.addedEdges.length,
    edgeRemoved: diff.removedEdges.length,
    edgeModified: diff.modifiedEdges.length,
    edgeUnchanged: diff.unchangedEdgeCount,
    hasChanges: false,
  }
  summary.hasChanges =
    summary.nodeAdded +
      summary.nodeRemoved +
      summary.nodeModified +
      summary.edgeAdded +
      summary.edgeRemoved +
      summary.edgeModified >
    0
  return summary
}

/**
 * Short human-readable label for a node, used in the diff list. Falls back to
 * the node id when the data has no label (legacy or malformed nodes).
 */
export function describeNode(node: CanvasNode): string {
  const label = (node.data as { label?: string }).label
  return label && label.length > 0 ? label : node.id
}

/**
 * Short edge label, e.g. "agent-1 → tool-2" or "agent-1 → tool-2 [branch:yes]".
 */
export function describeEdge(edge: CanvasEdge): string {
  const handle = edge.label ? ` [${edge.label}]` : ''
  return `${edge.source} → ${edge.target}${handle}`
}
