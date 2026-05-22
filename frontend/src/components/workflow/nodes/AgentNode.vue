<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { AgentNodeData } from '@/types/workflow'

defineProps<{
  id: string
  data: AgentNodeData
  selected?: boolean
}>()
</script>

<template>
  <!--
    Agent nodes carry the LLM-execution semantics. Their tint anchors to the
    GoA info-light blue so they read as the "thinking" node type at a glance
    on a canvas mixed with deterministic functions and tools.
  -->
  <div
    class="rounded-md border-2 px-3 py-2 min-w-[180px] shadow-sm transition-colors bg-[var(--goa-color-info-light)]"
    :class="selected ? 'border-[var(--goa-color-primary)]' : 'border-[var(--goa-color-info)]'"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="flex items-center gap-2 mb-1">
      <span
        class="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--goa-color-info)] text-[var(--goa-color-greyscale-white)] shrink-0"
        aria-hidden="true"
      >
        <ion-icon name="flash" style="font-size: 0.875rem;"></ion-icon>
      </span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-default)]">Agent</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text-default)] truncate">{{ data.label || 'Untitled agent' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] mt-1 truncate">
      {{ data.modelId || 'no model selected' }}
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
