<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasNode } from '@/types/workflow'
import type { IssueSeverity, ValidationIssue, ValidationResult } from '@/lib/workflowValidator'
import { kindLabel } from '@/lib/workflowValidator'

const props = defineProps<{
  result: ValidationResult
  nodes: CanvasNode[]
}>()

const emit = defineEmits<{
  (e: 'select', nodeId: string): void
  (e: 'close'): void
}>()

// Order issues so the most actionable (errors) bubble to the top while
// preserving the validator's authoring order within each severity. This is a
// stable sort because JS Array#sort is stable in V8.
const SEVERITY_RANK: Record<IssueSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

const orderedIssues = computed<ValidationIssue[]>(() =>
  [...props.result.issues].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  ),
)

const nodeLookup = computed(() => {
  const m = new Map<string, CanvasNode>()
  for (const n of props.nodes) m.set(n.id, n)
  return m
})

function nodeContext(issue: ValidationIssue): string {
  if (!issue.nodeId) return ''
  const node = nodeLookup.value.get(issue.nodeId)
  if (!node) return ''
  return kindLabel(node.data.kind)
}

function severityClass(s: IssueSeverity): string {
  switch (s) {
    case 'error':
      return 'border-l-[var(--goa-color-emergency)] bg-[var(--goa-color-emergency-background,#fff5f5)]'
    case 'warning':
      return 'border-l-[var(--goa-color-warning,#dfa700)] bg-[var(--goa-color-warning-background,#fff8e5)]'
    case 'info':
      return 'border-l-[var(--goa-color-information,#0070c4)] bg-[var(--goa-color-information-background,#e5f3ff)]'
  }
}

function severityIcon(s: IssueSeverity): string {
  switch (s) {
    case 'error':
      return 'close-circle'
    case 'warning':
      return 'warning'
    case 'info':
      return 'information-circle'
  }
}

function onRowClick(issue: ValidationIssue): void {
  if (issue.nodeId) emit('select', issue.nodeId)
}

function onRowKeydown(issue: ValidationIssue, event: KeyboardEvent): void {
  // Mirror native button behaviour — Enter/Space activate; other keys cascade
  // so the parent popover can still capture Escape to close.
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onRowClick(issue)
  }
}
</script>

<template>
  <div
    role="dialog"
    aria-label="Workflow validation issues"
    class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md shadow-lg max-h-[60vh] w-[28rem] flex flex-col min-h-0"
  >
    <header
      class="px-3 py-2 border-b border-[var(--goa-color-border)] flex items-center gap-2"
    >
      <h2 class="text-sm font-semibold text-[var(--goa-color-text-default)] flex-1">
        Validation
      </h2>
      <span
        v-if="result.counts.total > 0"
        class="text-xs text-[var(--goa-color-text-secondary)]"
        aria-live="polite"
      >
        <span v-if="result.counts.error" class="text-[var(--goa-color-emergency)] font-medium">
          {{ result.counts.error }} error{{ result.counts.error === 1 ? '' : 's' }}
        </span>
        <span v-if="result.counts.error && (result.counts.warning || result.counts.info)"> · </span>
        <span v-if="result.counts.warning">
          {{ result.counts.warning }} warning{{ result.counts.warning === 1 ? '' : 's' }}
        </span>
        <span v-if="result.counts.warning && result.counts.info"> · </span>
        <span v-if="result.counts.info">
          {{ result.counts.info }} info
        </span>
      </span>
      <button
        type="button"
        class="text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded p-1"
        aria-label="Close validation panel"
        @click="emit('close')"
      >
        <span aria-hidden="true" class="text-lg leading-none">×</span>
      </button>
    </header>

    <div class="overflow-y-auto flex-1 p-2 flex flex-col gap-1.5 min-h-0">
      <p
        v-if="result.counts.total === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] text-center py-6"
        data-testid="empty-state"
      >
        No issues found. This workflow is ready to run.
      </p>

      <template v-else>
        <div
          v-for="(issue, idx) in orderedIssues"
          :key="`${issue.code}-${issue.nodeId ?? 'graph'}-${idx}`"
          :class="[
            'text-sm flex gap-2 items-start border-l-4 p-2 rounded-sm transition-colors',
            severityClass(issue.severity),
            issue.nodeId ? 'cursor-pointer hover:brightness-95 focus-within:brightness-95' : '',
          ]"
          :role="issue.nodeId ? 'button' : 'note'"
          :tabindex="issue.nodeId ? 0 : -1"
          :aria-label="
            issue.nodeId
              ? `${issue.severity}: ${issue.message}. Click to select node.`
              : `${issue.severity}: ${issue.message}`
          "
          :data-testid="`issue-${issue.code}`"
          @click="onRowClick(issue)"
          @keydown="onRowKeydown(issue, $event)"
        >
          <goa-icon
            :type="severityIcon(issue.severity)"
            size="small"
            :theme="issue.severity === 'error' ? 'outline' : 'outline'"
            aria-hidden="true"
          ></goa-icon>
          <div class="flex-1 min-w-0">
            <p class="text-[var(--goa-color-text)] leading-snug break-words">
              {{ issue.message }}
            </p>
            <p
              v-if="issue.nodeId"
              class="text-xs text-[var(--goa-color-text-secondary)] mt-0.5 flex items-center gap-1.5"
            >
              <span v-if="nodeContext(issue)" class="uppercase tracking-wide font-medium">
                {{ nodeContext(issue) }}
              </span>
              <span class="font-mono">{{ issue.nodeId }}</span>
              <span aria-hidden="true">→</span>
              <span class="italic">click to select</span>
            </p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
