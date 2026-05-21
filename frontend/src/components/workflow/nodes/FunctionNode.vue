<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { FunctionNodeData } from '@/types/workflow'

defineProps<{
  id: string
  data: FunctionNodeData
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
        class="inline-block w-2 h-2 rounded-full bg-[var(--goa-color-info)]"
        aria-hidden="true"
      ></span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Function</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text)] truncate">{{ data.label || data.fnName || 'Untitled Function' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] mt-1 truncate font-mono">{{ data.fnName }}</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
