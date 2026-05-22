<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { ToolNodeData } from '@/types/workflow'

defineProps<{
  id: string
  data: ToolNodeData
  selected?: boolean
}>()
</script>

<template>
  <!--
    Tool nodes call out to external services (search, scrape, OCR, etc).
    Success-green tint signals "external I/O happens here" while keeping the
    shape consistent with the other node types.
  -->
  <div
    class="rounded-md border-2 px-3 py-2 min-w-[180px] shadow-sm transition-colors bg-[var(--goa-color-success-light)]"
    :class="selected ? 'border-[var(--goa-color-primary)]' : 'border-[var(--goa-color-success)]'"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="flex items-center gap-2 mb-1">
      <span
        class="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--goa-color-success)] text-[var(--goa-color-greyscale-white)] shrink-0"
        aria-hidden="true"
      >
        <ion-icon name="construct" style="font-size: 0.875rem;"></ion-icon>
      </span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-default)]">Tool</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text-default)] truncate">{{ data.label || data.toolName || 'Untitled tool' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] mt-1 truncate font-mono">{{ data.toolName }}</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
