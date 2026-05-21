<script setup lang="ts">
import type { NoteNodeData } from '@/types/workflow'

defineProps<{
  id: string
  data: NoteNodeData
  selected?: boolean
}>()
</script>

<template>
  <div
    class="rounded-md px-3 py-2 min-w-[180px] max-w-[260px] shadow-sm transition-colors border-2"
    :class="selected
      ? 'border-[var(--goa-color-primary)] bg-[var(--goa-color-warning)]/20'
      : 'border-[var(--goa-color-warning)] bg-[var(--goa-color-warning)]/10'"
  >
    <div class="flex items-center gap-2 mb-1">
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Note</span>
    </div>
    <div class="text-sm font-medium text-[var(--goa-color-text)] mb-1">{{ data.label || 'Note' }}</div>
    <div class="text-xs text-[var(--goa-color-text-secondary)] whitespace-pre-wrap break-words line-clamp-6">
      {{ data.markdown || 'Add notes here…' }}
    </div>
  </div>
</template>
