<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'

const session = useAgentSessionStore()

// Sort: pinned first (preserves the user's bookmarking choice across the
// otherwise reverse-chronological feed), then by iteration descending. The
// stable secondary sort keeps the timeline readable when there are 30+
// iterations and only one or two pinned.
const sortedIterations = computed(() =>
  [...session.iterations].sort((a, b) => {
    const ap = a.pinned ? 1 : 0
    const bp = b.pinned ? 1 : 0
    if (ap !== bp) return bp - ap
    return b.iteration - a.iteration
  }),
)

const pinTogglingIteration = ref<number | null>(null)

async function togglePin(iteration: number, current: boolean | undefined): Promise<void> {
  if (!session.sessionId) return
  pinTogglingIteration.value = iteration
  try {
    await session.toggleIterationPin(session.sessionId, iteration, !current)
  } finally {
    pinTogglingIteration.value = null
  }
}

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

const allExpanded = computed(
  () =>
    sortedIterations.value.length > 0 &&
    sortedIterations.value.every((i) => expanded.value.has(i.iteration)),
)

function toggleAll(): void {
  if (allExpanded.value) {
    manuallyExpanded.value = new Set()
    manuallyCollapsed.value = new Set(sortedIterations.value.map((i) => i.iteration))
  } else {
    manuallyExpanded.value = new Set(sortedIterations.value.map((i) => i.iteration))
    manuallyCollapsed.value = new Set()
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
  <!--
    Outer wrapper stays a styled <section> rather than goa-container because
    this panel is height-constrained and needs a flex chain through to the
    scrollable inner body. Forcing `display: flex` on a custom element host
    isn't reliable across shadow-DOM implementations. Visual treatment uses
    GoA tokens so the result still reads as a single grouped surface, with
    per-iteration rows separated by dividers (not per-row borders).
  -->
  <section
    class="flex flex-col min-h-0 overflow-hidden bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md"
    aria-label="Iteration timeline"
  >
    <header class="flex items-center justify-between gap-2 px-3 pt-3 pb-2 shrink-0">
      <h3 class="text-base font-semibold text-[var(--goa-color-text-default)] m-0">Iterations</h3>
      <div class="flex items-center gap-2">
        <button
          v-if="sortedIterations.length > 1"
          type="button"
          class="text-xs text-[var(--goa-color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded px-1"
          @click="toggleAll"
        >
          {{ allExpanded ? 'Collapse all' : 'Expand all' }}
        </button>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">{{ session.iterations.length }} total</span>
      </div>
    </header>
    <div class="overflow-y-auto flex-1 min-h-0 divide-y divide-[var(--goa-color-border)] px-3 pb-3">
        <p
          v-if="sortedIterations.length === 0"
          class="text-sm text-[var(--goa-color-text-secondary)] py-6 text-center m-0"
        >
          No iterations yet. Start the agent to see live progress.
        </p>
        <article
          v-for="iter in sortedIterations"
          :key="iter.iteration"
        >
          <div class="flex items-stretch gap-1">
            <button
              type="button"
              @click="toggle(iter.iteration)"
              :aria-expanded="expanded.has(iter.iteration)"
              :aria-controls="`iter-${iter.iteration}`"
              class="flex-1 px-2 py-2 flex items-center gap-3 text-left hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded"
            >
              <span class="text-xs font-semibold text-[var(--goa-color-primary-dark)] w-8 shrink-0">#{{ iter.iteration }}</span>
              <goa-badge :type="statusBadgeType(iter.status)" :content="iter.status ?? 'unknown'"></goa-badge>
              <span v-if="iter.pinned" class="text-xs uppercase tracking-wide text-[var(--goa-color-primary)] shrink-0">Pinned</span>
              <span v-if="iter.userMessage" class="text-sm text-[var(--goa-color-text)] truncate flex-1">
                {{ iter.userMessage }}
              </span>
              <span v-else class="text-sm text-[var(--goa-color-text-secondary)] flex-1">…</span>
              <span v-if="iter.tokensUsed" class="text-xs text-[var(--goa-color-text-secondary)] shrink-0">
                {{ iter.tokensUsed }} tok
              </span>
              <span v-if="iter.durationMs" class="text-xs text-[var(--goa-color-text-secondary)] shrink-0">
                {{ durationLabel(iter.durationMs) }}
              </span>
            </button>
            <!--
              Pin toggle is a sibling button so it's keyboard-reachable
              independently of the expand-collapse one — pinning shouldn't
              also expand, and unpinning shouldn't also collapse.
            -->
            <button
              type="button"
              data-testid="iteration-pin-toggle"
              :aria-pressed="iter.pinned ? 'true' : 'false'"
              :aria-label="iter.pinned ? `Unpin iteration ${iter.iteration}` : `Pin iteration ${iter.iteration}`"
              :title="iter.pinned ? 'Unpin' : 'Pin'"
              :disabled="pinTogglingIteration === iter.iteration"
              class="px-2 shrink-0 self-stretch flex items-center rounded hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] disabled:opacity-50"
              @click.stop="togglePin(iter.iteration, iter.pinned)"
            >
              <goa-icon
                :type="iter.pinned ? 'bookmark' : 'bookmark-outline'"
                size="small"
                :theme="iter.pinned ? 'filled' : 'outline'"
                :aria-hidden="true"
              />
            </button>
          </div>
          <div
            v-if="expanded.has(iter.iteration)"
            :id="`iter-${iter.iteration}`"
            class="px-2 pb-3 pt-1 flex flex-col gap-2"
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
