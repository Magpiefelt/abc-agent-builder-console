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
  <!--
    Function nodes are deterministic — no LLM, no token cost. The greyscale
    tint keeps them visually quieter than agent and tool nodes so the eye
    naturally lands on the LLM-cost nodes first.
  -->
  <div
    class="rounded-md border-2 px-3 py-2 min-w-[180px] shadow-sm transition-colors bg-[var(--goa-color-greyscale-100)]"
    :class="selected ? 'border-[var(--goa-color-primary)]' : 'border-[var(--goa-color-greyscale-400)]'"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="flex items-center gap-2 mb-1">
      <span
        class="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--goa-color-greyscale-700)] text-[var(--goa-color-greyscale-white)] shrink-0"
        aria-hidden="true"
      >
        <ion-icon name="code-slash" style="font-size: 0.875rem;"></ion-icon>
      </span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-default)]">Function</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text-default)] truncate">{{ data.label || data.fnName || 'Untitled function' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] mt-1 truncate font-mono">{{ data.fnName }}</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
