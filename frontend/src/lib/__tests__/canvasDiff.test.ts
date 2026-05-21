import { describe, it, expect } from 'vitest'
import { diffCanvas, summarizeCanvasDiff, describeNode, describeEdge } from '../canvasDiff'
import type { CanvasData, CanvasNode, CanvasEdge } from '@/types/workflow'

function agentNode(id: string, label = id, x = 0, y = 0): CanvasNode {
  return {
    id,
    type: 'agent',
    position: { x, y },
    data: {
      kind: 'agent',
      label,
      modelId: 'claude-haiku-4-5',
      classification: 'unclassified',
      tools: [],
    },
  }
}

function edge(id: string, source: string, target: string, label?: string): CanvasEdge {
  return { id, source, target, label }
}

function canvas(nodes: CanvasNode[] = [], edges: CanvasEdge[] = []): CanvasData {
  return { nodes, edges, version: 1 }
}

describe('diffCanvas', () => {
  it('reports no changes when canvases are identical', () => {
    const a = canvas([agentNode('a'), agentNode('b')], [edge('e1', 'a', 'b')])
    const b = canvas([agentNode('a'), agentNode('b')], [edge('e1', 'a', 'b')])
    const d = diffCanvas(a, b)
    expect(d.addedNodes).toEqual([])
    expect(d.removedNodes).toEqual([])
    expect(d.modifiedNodes).toEqual([])
    expect(d.unchangedNodeCount).toBe(2)
    expect(d.unchangedEdgeCount).toBe(1)
    expect(summarizeCanvasDiff(d).hasChanges).toBe(false)
  })

  it('detects added nodes and edges', () => {
    const a = canvas([agentNode('a')])
    const b = canvas([agentNode('a'), agentNode('b')], [edge('e1', 'a', 'b')])
    const d = diffCanvas(a, b)
    expect(d.addedNodes.map((n) => n.id)).toEqual(['b'])
    expect(d.removedNodes).toEqual([])
    expect(d.addedEdges.map((e) => e.id)).toEqual(['e1'])
    expect(summarizeCanvasDiff(d)).toMatchObject({
      nodeAdded: 1,
      nodeRemoved: 0,
      edgeAdded: 1,
      hasChanges: true,
    })
  })

  it('detects removed nodes and edges', () => {
    const a = canvas([agentNode('a'), agentNode('b')], [edge('e1', 'a', 'b')])
    const b = canvas([agentNode('a')])
    const d = diffCanvas(a, b)
    expect(d.removedNodes.map((n) => n.id)).toEqual(['b'])
    expect(d.removedEdges.map((e) => e.id)).toEqual(['e1'])
    expect(d.addedNodes).toEqual([])
  })

  it('detects a node modified via label change', () => {
    const a = canvas([agentNode('a', 'Original')])
    const b = canvas([agentNode('a', 'Renamed')])
    const d = diffCanvas(a, b)
    expect(d.modifiedNodes).toHaveLength(1)
    expect(d.modifiedNodes[0].id).toBe('a')
    expect((d.modifiedNodes[0].before.data as { label: string }).label).toBe('Original')
    expect((d.modifiedNodes[0].after.data as { label: string }).label).toBe('Renamed')
    expect(d.addedNodes).toEqual([])
    expect(d.removedNodes).toEqual([])
  })

  it('detects a node modified via position drift', () => {
    const a = canvas([agentNode('a', 'A', 10, 10)])
    const b = canvas([agentNode('a', 'A', 200, 50)])
    const d = diffCanvas(a, b)
    expect(d.modifiedNodes).toHaveLength(1)
    expect(d.unchangedNodeCount).toBe(0)
  })

  it('treats key-order differences inside data as unchanged', () => {
    const reorderedNode: CanvasNode = {
      id: 'a',
      type: 'agent',
      position: { y: 0, x: 0 },
      data: {
        tools: [],
        kind: 'agent',
        modelId: 'claude-haiku-4-5',
        classification: 'unclassified',
        label: 'a',
      },
    }
    const a = canvas([agentNode('a')])
    const b = canvas([reorderedNode])
    const d = diffCanvas(a, b)
    expect(d.modifiedNodes).toEqual([])
    expect(d.unchangedNodeCount).toBe(1)
  })

  it('detects an edge modified via re-targeting', () => {
    const a = canvas([agentNode('a'), agentNode('b'), agentNode('c')], [edge('e1', 'a', 'b')])
    const b = canvas([agentNode('a'), agentNode('b'), agentNode('c')], [edge('e1', 'a', 'c')])
    const d = diffCanvas(a, b)
    expect(d.modifiedEdges).toHaveLength(1)
    expect(d.modifiedEdges[0].before.target).toBe('b')
    expect(d.modifiedEdges[0].after.target).toBe('c')
  })

  it('describeNode falls back to id when label is missing', () => {
    const node: CanvasNode = {
      id: 'orphan',
      type: 'note',
      position: { x: 0, y: 0 },
      data: { kind: 'note', label: '', markdown: '' },
    }
    expect(describeNode(node)).toBe('orphan')
    expect(describeNode(agentNode('a', 'Researcher'))).toBe('Researcher')
  })

  it('describeEdge renders source, target, and optional label', () => {
    expect(describeEdge(edge('e1', 'a', 'b'))).toBe('a → b')
    expect(describeEdge(edge('e1', 'a', 'b', 'on-true'))).toBe('a → b [on-true]')
  })
})
