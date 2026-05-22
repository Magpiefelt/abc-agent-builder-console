<script setup lang="ts">
import { computed, markRaw, shallowRef } from 'vue'
import type { Component } from 'vue'
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypesObject,
} from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import AgentNode from './nodes/AgentNode.vue'
import FunctionNode from './nodes/FunctionNode.vue'
import ToolNode from './nodes/ToolNode.vue'
import NoteNode from './nodes/NoteNode.vue'
import { useReducedMotion } from '@/composables/useReducedMotion'
import type { CanvasEdge, CanvasNode, NodeData, NodeKind } from '@/types/workflow'

/**
 * Diff overlay descriptor (Backlog F1).
 *
 * When provided, the canvas renders visual indicators for nodes/edges that
 * would change if the user restored the preview version. The component itself
 * doesn't compute the diff — it just consumes the precomputed sets so the
 * heavy lifting stays in `lib/canvasDiff.ts` and the workflow store.
 *
 * Semantics (CURRENT canvas is the base):
 *   - `removedNodeIds`: present here, missing in preview → red striped ring
 *   - `modifiedNodeIds`: present in both, content differs → amber ring
 *   - `addedNodes`: present in preview, missing here → rendered as ghost
 *     nodes (low opacity, green dashed ring) at the position they'd occupy
 *     after restore
 *   - Edges follow the same convention.
 *
 * Ghost added-nodes are pseudo-nodes for visualisation only. They use an
 * `id` prefix (`__diff-ghost-`) so they cannot collide with a real node id,
 * are flagged `selectable: false` + `draggable: false`, and never participate
 * in the canvas mutation emits.
 */
export interface CanvasDiffOverlay {
  removedNodeIds: ReadonlySet<string>
  modifiedNodeIds: ReadonlySet<string>
  addedNodes: ReadonlyArray<CanvasNode>
  removedEdgeIds: ReadonlySet<string>
  modifiedEdgeIds: ReadonlySet<string>
  addedEdges: ReadonlyArray<CanvasEdge>
}

const props = defineProps<{
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  executionStages?: Map<string, { status: string }>
  diffOverlay?: CanvasDiffOverlay | null
}>()

const emit = defineEmits<{
  (e: 'update:nodes', nodes: CanvasNode[]): void
  (e: 'update:edges', edges: CanvasEdge[]): void
  (e: 'select', nodeId: string | null): void
  (e: 'drop-node', payload: { kind: NodeKind; defaults: Partial<NodeData>; position: { x: number; y: number } }): void
}>()

const GHOST_ID_PREFIX = '__diff-ghost-'

const nodeTypes = shallowRef<NodeTypesObject>({
  agent: markRaw(AgentNode) as unknown as Component,
  function: markRaw(FunctionNode) as unknown as Component,
  tool: markRaw(ToolNode) as unknown as Component,
  note: markRaw(NoteNode) as unknown as Component,
} as unknown as NodeTypesObject)

function diffClassForNode(id: string): string {
  const overlay = props.diffOverlay
  if (!overlay) return ''
  if (overlay.removedNodeIds.has(id)) return 'abc-diff-removed'
  if (overlay.modifiedNodeIds.has(id)) return 'abc-diff-modified'
  return ''
}

function diffClassForEdge(id: string): string {
  const overlay = props.diffOverlay
  if (!overlay) return ''
  if (overlay.removedEdgeIds.has(id)) return 'abc-diff-removed'
  if (overlay.modifiedEdgeIds.has(id)) return 'abc-diff-modified'
  return ''
}

const vueFlowNodes = computed<Node[]>(() => {
  const real = props.nodes.map((n) => {
    const stageStatus = props.executionStages?.get(n.id)?.status
    const execClass =
      stageStatus === 'running'
        ? 'ring-2 ring-[var(--goa-color-warning)]'
        : stageStatus === 'completed'
        ? 'ring-2 ring-[var(--goa-color-success)]'
        : stageStatus === 'error'
        ? 'ring-2 ring-[var(--goa-color-error)]'
        : ''
    const diffClass = diffClassForNode(n.id)
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      class: [execClass, diffClass].filter(Boolean).join(' '),
    } as Node
  })

  // Ghost nodes for "would be added on restore" — rendered as low-opacity
  // pseudo-nodes the user cannot select or drag. We prefix the id so the
  // ghost cannot collide with a real node and we can filter it back out in
  // event handlers.
  const ghosts: Node[] =
    props.diffOverlay?.addedNodes.map((n) => ({
      id: `${GHOST_ID_PREFIX}${n.id}`,
      type: n.type,
      position: n.position,
      data: n.data,
      class: 'abc-diff-added abc-diff-ghost',
      selectable: false,
      draggable: false,
      connectable: false,
    })) ?? []

  return [...real, ...ghosts]
})

// Respect the user's `prefers-reduced-motion` OS setting. Vue Flow's
// `animated` edges run a continuous keyframe; users who have asked their
// system to suppress motion shouldn't see it (WCAG 2.3.3).
const reducedMotion = useReducedMotion()

const vueFlowEdges = computed<Edge[]>(() => {
  const real = props.edges.map((e) => {
    const diffClass = diffClassForEdge(e.id)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      animated: !reducedMotion.value,
      class: diffClass,
    } as Edge
  })

  // Ghost edges for "would be added on restore". The source/target may point
  // to ghost nodes; that's fine — Vue Flow renders them as long as both
  // endpoints exist in the node list.
  const ghosts: Edge[] =
    props.diffOverlay?.addedEdges.map((e) => {
      const source = props.diffOverlay!.addedNodes.some((n) => n.id === e.source)
        ? `${GHOST_ID_PREFIX}${e.source}`
        : e.source
      const target = props.diffOverlay!.addedNodes.some((n) => n.id === e.target)
        ? `${GHOST_ID_PREFIX}${e.target}`
        : e.target
      return {
        id: `${GHOST_ID_PREFIX}${e.id}`,
        source,
        target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
        animated: false,
        class: 'abc-diff-added abc-diff-ghost',
        selectable: false,
      } as Edge
    }) ?? []

  return [...real, ...ghosts]
})

const { project } = useVueFlow()

function onConnect(connection: Connection): void {
  if (!connection.source || !connection.target) return
  if (connection.source === connection.target) return // no self-loops
  // Dedupe: a single edge per ordered pair (V1)
  if (props.edges.some((e) => e.source === connection.source && e.target === connection.target)) return
  const newEdge: CanvasEdge = {
    id: `${connection.source}-${connection.target}-${Date.now()}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
  }
  emit('update:edges', [...props.edges, newEdge])
}

function onNodesChange(changes: NodeChange[]): void {
  let nodes = [...props.nodes]
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      nodes = nodes.map((n) =>
        n.id === change.id ? { ...n, position: change.position! } : n
      )
    } else if (change.type === 'remove') {
      nodes = nodes.filter((n) => n.id !== change.id)
    }
  }
  emit('update:nodes', nodes)
}

function onEdgesChange(changes: EdgeChange[]): void {
  let edges = [...props.edges]
  for (const change of changes) {
    if (change.type === 'remove') {
      edges = edges.filter((e) => e.id !== change.id)
    }
  }
  emit('update:edges', edges)
}

function onNodeClick(event: { node: Node }): void {
  // Ghost nodes (added-on-restore previews) are not selectable — but Vue Flow
  // still fires node-click even when `selectable: false`. Suppress here so
  // the PropertiesPanel never receives a ghost id it can't resolve.
  if (event.node.id.startsWith(GHOST_ID_PREFIX)) return
  emit('select', event.node.id)
}

function onPaneClick(): void {
  emit('select', null)
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const raw = event.dataTransfer?.getData('application/abc.node')
  if (!raw) return
  let payload: { kind: NodeKind; defaults: Partial<NodeData> }
  try {
    payload = JSON.parse(raw)
  } catch {
    return
  }
  const position = project({ x: event.clientX, y: event.clientY })
  emit('drop-node', { kind: payload.kind, defaults: payload.defaults, position })
}
</script>

<template>
  <div class="w-full h-full" @dragover="onDragOver" @drop="onDrop">
    <VueFlow
      :nodes="vueFlowNodes"
      :edges="vueFlowEdges"
      :node-types="nodeTypes"
      :fit-view-on-init="true"
      @connect="onConnect"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
    />
  </div>
</template>

<style>
.vue-flow__node {
  font-family: var(--goa-font-family);
}

/* ============================================================================
   F1 — Workflow version diff overlay
   Visual indicators applied to nodes/edges while a version preview is active.
   Removed: present in current canvas but not in preview → red striped ring.
   Modified: present in both, content differs → amber ring.
   Added: ghost node from preview canvas → low opacity + green dashed ring.
   ============================================================================ */
.vue-flow__node.abc-diff-removed {
  outline: 2px solid var(--goa-color-error);
  outline-offset: 4px;
  /* Striped background hint via repeating gradient, keyed off the existing
     node surface so the original node content stays readable. */
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 6px,
    rgba(238, 39, 70, 0.08) 6px,
    rgba(238, 39, 70, 0.08) 12px
  );
  border-radius: 6px;
}
.vue-flow__node.abc-diff-modified {
  outline: 2px solid var(--goa-color-warning);
  outline-offset: 4px;
  border-radius: 6px;
}
.vue-flow__node.abc-diff-added {
  outline: 2px dashed var(--goa-color-success);
  outline-offset: 4px;
  border-radius: 6px;
}
.vue-flow__node.abc-diff-ghost {
  opacity: 0.55;
  pointer-events: none;
}
.vue-flow__edge.abc-diff-removed .vue-flow__edge-path {
  stroke: var(--goa-color-error);
  stroke-dasharray: 6 3;
  stroke-width: 2.5px;
}
.vue-flow__edge.abc-diff-modified .vue-flow__edge-path {
  stroke: var(--goa-color-warning);
  stroke-width: 2.5px;
}
.vue-flow__edge.abc-diff-added .vue-flow__edge-path {
  stroke: var(--goa-color-success);
  stroke-dasharray: 6 3;
  stroke-width: 2.5px;
}
.vue-flow__edge.abc-diff-ghost {
  opacity: 0.6;
}
</style>
