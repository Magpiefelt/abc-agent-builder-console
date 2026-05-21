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
import type { CanvasEdge, CanvasNode, NodeData, NodeKind } from '@/types/workflow'

const props = defineProps<{
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  executionStages?: Map<string, { status: string }>
}>()

const emit = defineEmits<{
  (e: 'update:nodes', nodes: CanvasNode[]): void
  (e: 'update:edges', edges: CanvasEdge[]): void
  (e: 'select', nodeId: string | null): void
  (e: 'drop-node', payload: { kind: NodeKind; defaults: Partial<NodeData>; position: { x: number; y: number } }): void
}>()

const nodeTypes = shallowRef<NodeTypesObject>({
  agent: markRaw(AgentNode) as unknown as Component,
  function: markRaw(FunctionNode) as unknown as Component,
  tool: markRaw(ToolNode) as unknown as Component,
  note: markRaw(NoteNode) as unknown as Component,
} as unknown as NodeTypesObject)

const vueFlowNodes = computed<Node[]>(() =>
  props.nodes.map((n) => {
    const stageStatus = props.executionStages?.get(n.id)?.status
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      class:
        stageStatus === 'running'
          ? 'ring-2 ring-[var(--goa-color-warning)]'
          : stageStatus === 'completed'
          ? 'ring-2 ring-[var(--goa-color-success)]'
          : stageStatus === 'error'
          ? 'ring-2 ring-[var(--goa-color-error)]'
          : '',
    }
  })
)

const vueFlowEdges = computed<Edge[]>(() =>
  props.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label,
    animated: true,
  }))
)

const { project } = useVueFlow()

function onConnect(connection: Connection): void {
  const newEdge: CanvasEdge = {
    id: `${connection.source}-${connection.target}-${Date.now()}`,
    source: connection.source!,
    target: connection.target!,
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
</style>
