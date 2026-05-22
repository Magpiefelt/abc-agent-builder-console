<script setup lang="ts">
/**
 * Operational dashboard for administrators.
 *
 * Renders pre-aggregated stats from /api/admin/dashboard:
 *   - Session counts across 24h / 7d / 30d windows
 *   - Session status + classification breakdowns (last 30d)
 *   - Workflow execution counts and status breakdown
 *   - Top tool invocations (last 7d) with success rate
 *   - Top model usage (last 30d)
 *   - PII detection summary (last 7d) by type and action
 *
 * All aggregation happens server-side in SQL; this component just renders.
 */
import { computed, onActivated, onDeactivated, onBeforeUnmount, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { DashboardSummary } from '@/types/admin'

const data = ref<DashboardSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const lastFetched = ref<Date | null>(null)

const POLL_INTERVAL_MS = 60_000
let pollHandle: ReturnType<typeof setInterval> | null = null

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.admin.dashboard()
    lastFetched.value = new Date()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function startPolling(): void {
  if (pollHandle) return
  pollHandle = setInterval(() => {
    void load()
  }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
}

// Initial mount: load + start poll. The Admin view uses <KeepAlive>, so we
// also restart the timer on activation and stop it on deactivation to avoid
// background polling when the user is on another tab.
void load()
startPolling()
onActivated(() => {
  void load()
  startPolling()
})
onDeactivated(stopPolling)
onBeforeUnmount(stopPolling)

function findWindow(
  totals: DashboardSummary['sessions']['totals'],
  label: '24h' | '7d' | '30d',
): number {
  return totals.find((t) => t.windowLabel === label)?.count ?? 0
}

const sessionsWindow = computed(() => data.value?.sessions.totals ?? [])
const executionsWindow = computed(() => data.value?.workflowExecutions.totals ?? [])

const sessionsByStatus = computed(() => data.value?.sessions.byStatus ?? [])
const sessionsByClassification = computed(() => data.value?.sessions.byClassification ?? [])
const executionsByStatus = computed(() => data.value?.workflowExecutions.byStatus ?? [])
const tools = computed(() => data.value?.tools ?? [])
const models = computed(() => data.value?.models ?? [])
const piiByType = computed(() => data.value?.pii.byType ?? [])
const piiByAction = computed(() => data.value?.pii.byAction ?? [])
const piiTotal = computed(() => data.value?.pii.last7Days ?? 0)

// Compute a percent-of-total for inline bar rendering. Avoids zero division.
function pct(value: number, total: number): number {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

const sessionsByStatusTotal = computed(() =>
  sessionsByStatus.value.reduce((sum, r) => sum + r.count, 0),
)
const sessionsByClassificationTotal = computed(() =>
  sessionsByClassification.value.reduce((sum, r) => sum + r.count, 0),
)
const executionsByStatusTotal = computed(() =>
  executionsByStatus.value.reduce((sum, r) => sum + r.count, 0),
)
const toolsTotal = computed(() => tools.value.reduce((sum, t) => sum + t.calls, 0))
const modelsTotal = computed(() => models.value.reduce((sum, m) => sum + m.sessions, 0))

function successRate(t: { calls: number; successes: number }): string {
  if (!t.calls) return '—'
  return `${Math.round((t.successes / t.calls) * 100)}%`
}

function formatFetched(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleTimeString()
}
</script>

<template>
  <section aria-label="Operational dashboard" class="space-y-4">
    <header class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Dashboard</h2>
        <p class="text-xs text-[var(--goa-color-text-secondary)]">
          Operational snapshot. Refreshes every minute while this tab is open.
        </p>
      </div>
      <div class="flex items-center gap-3 text-xs text-[var(--goa-color-text-secondary)]">
        <span v-if="lastFetched" aria-live="polite">
          Updated {{ formatFetched(lastFetched) }}
        </span>
        <goa-button type="tertiary" size="compact" :disabled="loading || undefined" @_click="load">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </goa-button>
      </div>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load dashboard">
      {{ error }}
    </goa-callout>

    <div v-if="loading && !data" class="text-sm text-[var(--goa-color-text-secondary)]">
      Loading dashboard…
    </div>

    <div v-if="data" class="grid gap-4 md:grid-cols-3">
      <!-- Free Agent sessions, three windows -->
      <article
        v-for="t in sessionsWindow"
        :key="`sessions-${t.windowLabel}`"
        class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
      >
        <div class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
          Free Agent sessions · last {{ t.windowLabel }}
        </div>
        <div class="text-3xl font-semibold mt-1">{{ t.count.toLocaleString() }}</div>
      </article>
    </div>

    <div v-if="data" class="grid gap-4 md:grid-cols-3">
      <article
        v-for="t in executionsWindow"
        :key="`exec-${t.windowLabel}`"
        class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
      >
        <div class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
          Workflow runs · last {{ t.windowLabel }}
        </div>
        <div class="text-3xl font-semibold mt-1">{{ t.count.toLocaleString() }}</div>
      </article>
    </div>

    <div v-if="data" class="grid gap-4 lg:grid-cols-2">
      <!-- Session status breakdown -->
      <article class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded">
        <h3 class="font-semibold text-sm text-[var(--goa-color-primary-dark)] mb-2">
          Session status (30d)
        </h3>
        <ul v-if="sessionsByStatus.length > 0" class="space-y-2">
          <li v-for="row in sessionsByStatus" :key="row.status" class="text-sm">
            <div class="flex items-center justify-between text-xs">
              <span class="uppercase">{{ row.status }}</span>
              <span class="text-[var(--goa-color-text-secondary)]">
                {{ row.count.toLocaleString() }} ({{ pct(row.count, sessionsByStatusTotal) }}%)
              </span>
            </div>
            <div
              class="h-2 bg-gray-100 rounded mt-1 overflow-hidden"
              role="presentation"
              aria-hidden="true"
            >
              <div
                class="h-full bg-[var(--goa-color-primary)]"
                :style="{ width: `${pct(row.count, sessionsByStatusTotal)}%` }"
              />
            </div>
          </li>
        </ul>
        <div v-else class="text-xs text-[var(--goa-color-text-secondary)]">
          No sessions in the last 30 days.
        </div>
      </article>

      <!-- Classification breakdown -->
      <article class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded">
        <h3 class="font-semibold text-sm text-[var(--goa-color-primary-dark)] mb-2">
          Session classification (30d)
        </h3>
        <ul v-if="sessionsByClassification.length > 0" class="space-y-2">
          <li v-for="row in sessionsByClassification" :key="row.classification" class="text-sm">
            <div class="flex items-center justify-between text-xs">
              <span class="uppercase">{{ row.classification.replace('_', ' ') }}</span>
              <span class="text-[var(--goa-color-text-secondary)]">
                {{ row.count.toLocaleString() }} ({{ pct(row.count, sessionsByClassificationTotal) }}%)
              </span>
            </div>
            <div class="h-2 bg-gray-100 rounded mt-1 overflow-hidden" aria-hidden="true">
              <div
                class="h-full bg-[var(--goa-color-primary)]"
                :style="{ width: `${pct(row.count, sessionsByClassificationTotal)}%` }"
              />
            </div>
          </li>
        </ul>
        <div v-else class="text-xs text-[var(--goa-color-text-secondary)]">
          No sessions in the last 30 days.
        </div>
      </article>

      <!-- Workflow execution status -->
      <article class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded">
        <h3 class="font-semibold text-sm text-[var(--goa-color-primary-dark)] mb-2">
          Workflow status (30d)
        </h3>
        <ul v-if="executionsByStatus.length > 0" class="space-y-2">
          <li v-for="row in executionsByStatus" :key="row.status" class="text-sm">
            <div class="flex items-center justify-between text-xs">
              <span class="uppercase">{{ row.status }}</span>
              <span class="text-[var(--goa-color-text-secondary)]">
                {{ row.count.toLocaleString() }} ({{ pct(row.count, executionsByStatusTotal) }}%)
              </span>
            </div>
            <div class="h-2 bg-gray-100 rounded mt-1 overflow-hidden" aria-hidden="true">
              <div
                class="h-full bg-[var(--goa-color-primary)]"
                :style="{ width: `${pct(row.count, executionsByStatusTotal)}%` }"
              />
            </div>
          </li>
        </ul>
        <div v-else class="text-xs text-[var(--goa-color-text-secondary)]">
          No workflow runs in the last 30 days.
        </div>
      </article>

      <!-- Model usage -->
      <article class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded">
        <h3 class="font-semibold text-sm text-[var(--goa-color-primary-dark)] mb-2">
          Model usage (30d)
        </h3>
        <ul v-if="models.length > 0" class="space-y-2">
          <li v-for="row in models" :key="row.modelId" class="text-sm">
            <div class="flex items-center justify-between text-xs">
              <span class="font-mono">{{ row.modelId }}</span>
              <span class="text-[var(--goa-color-text-secondary)]">
                {{ row.sessions.toLocaleString() }} ({{ pct(row.sessions, modelsTotal) }}%)
              </span>
            </div>
            <div class="h-2 bg-gray-100 rounded mt-1 overflow-hidden" aria-hidden="true">
              <div
                class="h-full bg-[var(--goa-color-primary)]"
                :style="{ width: `${pct(row.sessions, modelsTotal)}%` }"
              />
            </div>
          </li>
        </ul>
        <div v-else class="text-xs text-[var(--goa-color-text-secondary)]">
          No model usage in the last 30 days.
        </div>
      </article>
    </div>

    <!-- Tool usage -->
    <article
      v-if="data"
      class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
    >
      <h3 class="font-semibold text-sm text-[var(--goa-color-primary-dark)] mb-3">
        Top tools (7d) · {{ toolsTotal.toLocaleString() }} total calls
      </h3>
      <goa-table v-if="tools.length > 0" width="100%" variant="normal" version="2">
        <thead>
          <tr>
            <th>Tool</th>
            <th class="text-right">Calls</th>
            <th class="text-right">Successes</th>
            <th class="text-right">Success rate</th>
            <th class="text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tools" :key="t.tool">
            <td class="font-mono text-xs">{{ t.tool }}</td>
            <td class="text-right text-xs">{{ t.calls.toLocaleString() }}</td>
            <td class="text-right text-xs">{{ t.successes.toLocaleString() }}</td>
            <td class="text-right text-xs">{{ successRate(t) }}</td>
            <td class="text-right text-xs">{{ pct(t.calls, toolsTotal) }}%</td>
          </tr>
        </tbody>
      </goa-table>
      <div v-else class="text-xs text-[var(--goa-color-text-secondary)]">
        No tool invocations in the last 7 days.
      </div>
    </article>

    <!-- PII detections -->
    <article
      v-if="data"
      class="p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded"
    >
      <h3 class="font-semibold text-sm text-[var(--goa-color-primary-dark)] mb-3">
        PII detections (7d) · {{ piiTotal.toLocaleString() }} total
      </h3>
      <div v-if="piiTotal === 0" class="text-xs text-[var(--goa-color-text-secondary)]">
        No PII detections in the last 7 days.
      </div>
      <div v-else class="grid gap-4 md:grid-cols-2">
        <div>
          <h4 class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">
            By type
          </h4>
          <ul class="space-y-1">
            <li
              v-for="row in piiByType"
              :key="row.detectionType"
              class="flex items-center justify-between text-xs"
            >
              <span class="font-mono">{{ row.detectionType }}</span>
              <span class="text-[var(--goa-color-text-secondary)]">{{ row.count }}</span>
            </li>
          </ul>
        </div>
        <div>
          <h4 class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">
            By action
          </h4>
          <ul class="space-y-1">
            <li
              v-for="row in piiByAction"
              :key="row.action"
              class="flex items-center justify-between text-xs"
            >
              <span class="uppercase">{{ row.action }}</span>
              <span class="text-[var(--goa-color-text-secondary)]">{{ row.count }}</span>
            </li>
          </ul>
        </div>
      </div>
    </article>
  </section>
</template>
