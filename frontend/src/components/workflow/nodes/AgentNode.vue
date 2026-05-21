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
  <div
    class="rounded-md bg-[var(--goa-color-surface)] border-2 px-3 py-2 min-w-[180px] shadow-sm transition-colors"
    :class="selected ? 'border-[var(--goa-color-primary)]' : 'border-[var(--goa-color-border)]'"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="flex items-center gap-2 mb-1">
      <span
        class="inline-block w-2 h-2 rounded-full bg-[var(--goa-color-primary)]"
        aria-hidden="true"
      ></span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Agent</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text)] truncate">{{ data.label || 'Untitled Agent' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] mt-1 truncate">
      {{ data.templateId ? data.templateId : 'custom' }} · {{ data.modelId }}
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
