<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'

const session = useAgentSessionStore()

const sortedIterations = computed(() =>
  [...session.iterations].sort((a, b) => b.iteration - a.iteration),
)

const manuallyExpanded = ref<Set<number>>(new Set())
const manuallyCollapsed = ref<Set<number>>(new Set())

// The currently-running iteration is auto-expanded so the operator can watch
// it without clicking. The user can still collapse it explicitly.
const expanded = computed<Set<number>>(() => {
  const next = new Set(manuallyExpanded.value)
  const running = session.currentIteration
  if (session.status === 'running' && running > 0 && !manuallyCollapsed.value.has(running)) {
    next.add(running)
  }
  return next
})

function toggle(iteration: number): void {
  if (expanded.value.has(iteration)) {
    const m = new Set(manuallyExpanded.value)
    m.delete(iteration)
    manuallyExpanded.value = m
    const c = new Set(manuallyCollapsed.value)
    c.add(iteration)
    manuallyCollapsed.value = c
  } else {
    const m = new Set(manuallyExpanded.value)
    m.add(iteration)
    manuallyExpanded.value = m
    const c = new Set(manuallyCollapsed.value)
    c.delete(iteration)
    manuallyCollapsed.value = c
  }
}

watch(
  () => session.sessionId,
  () => {
    manuallyExpanded.value = new Set()
    manuallyCollapsed.value = new Set()
  },
)

function statusBadgeType(s: string | undefined): 'success' | 'emergency' | 'information' | 'midtone' {
  switch (s) {
    case 'completed':
      return 'success'
    case 'error':
      return 'emergency'
    case 'running':
      return 'information'
    default:
      return 'midtone'
  }
}

function durationLabel(ms: number | undefined): string {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md flex flex-col min-h-0 overflow-hidden"
    aria-label="Iteration timeline"
  >
    <header class="px-3 py-2 border-b border-[var(--goa-color-border)] flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[var(--goa-color-primary-dark)]">Iterations</h3>
      <span class="text-xs text-[var(--goa-color-text-secondary)]">{{ session.iterations.length }} total</span>
    </header>
    <div class="overflow-y-auto flex-1 p-2 flex flex-col gap-2">
      <div
        v-if="sortedIterations.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-6 text-center"
      >
        No iterations yet. Start the agent to see live progress.
      </div>
      <article
        v-for="iter in sortedIterations"
        :key="iter.iteration"
        class="border border-[var(--goa-color-border)] rounded-md"
      >
        <button
          type="button"
          @click="toggle(iter.iteration)"
          :aria-expanded="expanded.has(iter.iteration)"
          :aria-controls="`iter-${iter.iteration}`"
          class="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded-md"
        >
          <span class="text-xs font-semibold text-[var(--goa-color-primary-dark)]">#{{ iter.iteration }}</span>
          <goa-badge :type="statusBadgeType(iter.status)" :content="iter.status ?? 'unknown'"></goa-badge>
          <span v-if="iter.userMessage" class="text-sm text-[var(--goa-color-text)] truncate flex-1">
            {{ iter.userMessage }}
          </span>
          <span v-else class="text-sm text-[var(--goa-color-text-secondary)] flex-1">…</span>
          <span v-if="iter.tokensUsed" class="text-xs text-[var(--goa-color-text-secondary)]">
            {{ iter.tokensUsed }} tok
          </span>
          <span v-if="iter.durationMs" class="text-xs text-[var(--goa-color-text-secondary)]">
            {{ durationLabel(iter.durationMs) }}
          </span>
        </button>
        <div
          v-if="expanded.has(iter.iteration)"
          :id="`iter-${iter.iteration}`"
          class="px-3 pb-3 pt-1 border-t border-[var(--goa-color-border)] bg-[var(--goa-color-background)] flex flex-col gap-2"
        >
          <div v-if="iter.thinking">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-1">Thinking</h4>
            <p class="text-sm text-[var(--goa-color-text)] whitespace-pre-wrap">{{ iter.thinking }}</p>
          </div>
          <div v-if="iter.toolCalls.length > 0">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-1">Tool Calls</h4>
            <ul class="text-sm flex flex-col gap-1">
              <li
                v-for="(call, idx) in iter.toolCalls"
                :key="`${call.tool}-${idx}`"
                class="font-mono text-xs px-2 py-1 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
              >
                {{ call.tool }}
              </li>
            </ul>
          </div>
          <div v-if="iter.toolResults.length > 0">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-1">Tool Results</h4>
            <ul class="text-sm flex flex-col gap-1">
              <li
                v-for="(r, idx) in iter.toolResults"
                :key="`${r.tool}-${idx}`"
                class="flex items-center gap-2 text-xs px-2 py-1 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
              >
                <span
                  :class="[
                    'inline-block w-2 h-2 rounded-full',
                    r.success ? 'bg-[var(--goa-color-success)]' : 'bg-[var(--goa-color-error)]',
                  ]"
                  aria-hidden="true"
                />
                <span class="font-mono">{{ r.tool }}</span>
                <span class="text-[var(--goa-color-text-secondary)]">{{ durationLabel(r.durationMs) }}</span>
                <span v-if="r.error" class="text-[var(--goa-color-error)] truncate">{{ r.error }}</span>
              </li>
            </ul>
          </div>
          <div v-if="iter.error" class="text-sm text-[var(--goa-color-error)]">
            {{ iter.error }}
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
