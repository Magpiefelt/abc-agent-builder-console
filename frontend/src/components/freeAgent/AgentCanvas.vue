<script setup lang="ts">
import { computed } from 'vue'
import { VueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { useAgentSessionStore } from '@/stores/agentSession'

const session = useAgentSessionStore()

const ITERATION_RADIUS = 220
const TOOL_RADIUS = 380
const ARTIFACT_Y = 320

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

  const sortedIters = [...session.iterations].sort((a, b) => a.iteration - b.iteration)
  const total = Math.max(sortedIters.length, 1)
  sortedIters.forEach((iter, idx) => {
    const angle = -Math.PI / 2 + (Math.PI * idx) / Math.max(total - 1, 1)
    const safeAngle = total === 1 ? -Math.PI / 2 : angle
    const x = Math.cos(safeAngle) * ITERATION_RADIUS
    const y = Math.sin(safeAngle) * ITERATION_RADIUS - 80
    const nodeId = `iter-${iter.iteration}`
    const completed = iter.status === 'completed'
    nodes.push({
      id: nodeId,
      type: 'default',
      position: { x, y },
      data: { label: `Iter #${iter.iteration}` },
      style: {
        backgroundColor: completed
          ? 'var(--goa-color-success)'
          : 'var(--goa-color-primary-light)',
        color: completed ? '#fff' : 'var(--goa-color-primary-dark)',
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

  session.toolCallLog.forEach((call, idx) => {
    const parent = `iter-${call.iteration}`
    const angle = Math.PI / 2 + (Math.PI * idx) / Math.max(session.toolCallLog.length, 1)
    const x = Math.cos(angle) * TOOL_RADIUS
    const y = Math.sin(angle) * TOOL_RADIUS - 40
    const nodeId = `tool-${call.iteration}-${idx}`
    nodes.push({
      id: nodeId,
      type: 'default',
      position: { x, y },
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
      id: `${parent}-${nodeId}`,
      source: parent,
      target: nodeId,
      style: { stroke: call.success ? 'var(--goa-color-success)' : 'var(--goa-color-error)' },
    })
  })

  session.artifacts.forEach((a, idx) => {
    const nodeId = `artifact-${idx}`
    const spreadX = (idx - (session.artifacts.length - 1) / 2) * 160
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
        maxWidth: 160,
      },
    })
    const parent = `iter-${a.iteration}`
    edges.push({
      id: `${parent}-${nodeId}`,
      source: parent,
      target: nodeId,
      animated: true,
      style: { stroke: 'var(--goa-color-primary)', strokeDasharray: '4 4' },
    })
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

<style scoped>
.vue-flow__minimap {
  background-color: var(--goa-color-background);
}
</style>
