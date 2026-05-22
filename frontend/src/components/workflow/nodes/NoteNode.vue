<script setup lang="ts">
import type { NoteNodeData } from '@/types/workflow'

defineProps<{
  id: string
  data: NoteNodeData
  selected?: boolean
}>()
</script>

<template>
  <!--
    Note nodes are skipped at execution time. The amber tint signals "this
    won't run" so an operator scanning the canvas knows at a glance which
    nodes contribute to the actual workflow.
  -->
  <div
    class="rounded-md px-3 py-2 min-w-[180px] max-w-[260px] shadow-sm transition-colors border-2 bg-[var(--goa-color-important-light)]"
    :class="selected
      ? 'border-[var(--goa-color-primary)]'
      : 'border-[var(--goa-color-warning)]'"
  >
    <div class="flex items-center gap-2 mb-1">
      <span
        class="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--goa-color-warning)] text-[var(--goa-color-greyscale-white)] shrink-0"
        aria-hidden="true"
      >
        <ion-icon name="document-text" style="font-size: 0.875rem;"></ion-icon>
      </span>
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-default)]">Note · skipped at run</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text-default)] mb-1">{{ data.label || 'Note' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] whitespace-pre-wrap break-words line-clamp-6">
      {{ data.markdown || 'Add notes here…' }}
    </div>
  </div>
</template>
