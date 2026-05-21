<script setup lang="ts">
import { computed } from 'vue'
import { VueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { useAgentSessionStore } from '@/stores/agentSession'

const session = useAgentSessionStore()

const ITERATION_RADIUS = 240
const TOOL_OFFSET = 120
const ARTIFACT_Y = 360

const elements = computed<{ nodes: Node[]; edges: Edge[] }>(() => {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const agentRunning = session.status === 'running'
  nodes.push({
    id: 'agent',
    type: 'default',
    position: { x: 0, y: 0 },
    data: { label: 'Agent' },
    style: {
      backgroundColor: 'var(--goa-color-primary)',
      color: '#fff',
      border: 'none',
      padding: '12px 18px',
      borderRadius: '50%',
      width: 90,
      height: 90,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 600,
      boxShadow: agentRunning ? '0 0 0 6px rgba(0, 112, 196, 0.25)' : 'none',
    },
  })

  // Iteration nodes on an arc above the agent.
  const sortedIters = [...session.iterations].sort((a, b) => a.iteration - b.iteration)
  const iterPositions = new Map<number, { x: number; y: number }>()
  const total = sortedIters.length
  sortedIters.forEach((iter, idx) => {
    const t = total === 1 ? 0.5 : idx / (total - 1)
    const angle = -Math.PI + Math.PI * t // sweep left → right above the agent
    const x = Math.cos(angle) * ITERATION_RADIUS
    const y = Math.sin(angle) * ITERATION_RADIUS - 20
    iterPositions.set(iter.iteration, { x, y })

    const nodeId = `iter-${iter.iteration}`
    const completed = iter.status === 'completed'
    const errored = iter.status === 'error'
    nodes.push({
      id: nodeId,
      type: 'default',
      position: { x, y },
      data: { label: `Iter #${iter.iteration}` },
      style: {
        backgroundColor: errored
          ? 'var(--goa-color-error)'
          : completed
            ? 'var(--goa-color-success)'
            : 'var(--goa-color-primary-light)',
        color: errored || completed ? '#fff' : 'var(--goa-color-primary-dark)',
        border: '1px solid var(--goa-color-border)',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
      },
    })
    edges.push({
      id: `agent-${nodeId}`,
      source: 'agent',
      target: nodeId,
      style: { stroke: 'var(--goa-color-border)' },
    })
  })

  // Cluster tool calls beside their parent iteration so the graph reads
  // "this iteration ran these tools" rather than a scatter of unrelated nodes.
  const toolsByIter = new Map<number, Array<{ tool: string; success: boolean; error?: string }>>()
  for (const call of session.toolCallLog) {
    if (!toolsByIter.has(call.iteration)) toolsByIter.set(call.iteration, [])
    toolsByIter.get(call.iteration)!.push(call)
  }
  for (const [iteration, calls] of toolsByIter) {
    const parentPos = iterPositions.get(iteration)
    if (!parentPos) continue
    const parentId = `iter-${iteration}`
    calls.forEach((call, idx) => {
      const direction = parentPos.x >= 0 ? 1 : -1
      const offsetY = idx * 32 - ((calls.length - 1) * 32) / 2
      const nodeId = `tool-${iteration}-${idx}`
      nodes.push({
        id: nodeId,
        type: 'default',
        position: {
          x: parentPos.x + direction * TOOL_OFFSET,
          y: parentPos.y + offsetY,
        },
        data: { label: call.tool },
        style: {
          backgroundColor: 'var(--goa-color-surface)',
          color: call.success ? 'var(--goa-color-text)' : 'var(--goa-color-error)',
          border: `1px solid ${call.success ? 'var(--goa-color-border)' : 'var(--goa-color-error)'}`,
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'monospace',
        },
      })
      edges.push({
        id: `${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        style: {
          stroke: call.success ? 'var(--goa-color-success)' : 'var(--goa-color-error)',
        },
      })
    })
  }

  // Artifacts pinned along the bottom row, only linked when their parent
  // iteration is in the graph.
  session.artifacts.forEach((a, idx) => {
    const nodeId = `artifact-${idx}`
    const spreadX = (idx - (session.artifacts.length - 1) / 2) * 170
    nodes.push({
      id: nodeId,
      type: 'default',
      position: { x: spreadX, y: ARTIFACT_Y },
      data: { label: `📎 ${a.title}` },
      style: {
        backgroundColor: 'var(--goa-color-primary-light)',
        color: 'var(--goa-color-primary-dark)',
        border: '1px dashed var(--goa-color-primary)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 11,
        maxWidth: 170,
      },
    })
    const parentId = `iter-${a.iteration}`
    if (iterPositions.has(a.iteration)) {
      edges.push({
        id: `${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        animated: true,
        style: { stroke: 'var(--goa-color-primary)', strokeDasharray: '4 4' },
      })
    }
  })

  return { nodes, edges }
})
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md overflow-hidden h-full min-h-[260px]"
    aria-label="Agent execution canvas"
  >
    <VueFlow
      :nodes="elements.nodes"
      :edges="elements.edges"
      :fit-view-on-init="true"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :zoom-on-scroll="false"
      :pan-on-scroll="true"
      class="h-full"
    >
      <Background pattern-color="var(--goa-color-border)" :gap="20" />
      <MiniMap pannable zoomable />
    </VueFlow>
  </section>
</template>
