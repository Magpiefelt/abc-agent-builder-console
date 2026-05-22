<script setup lang="ts">
/**
 * Operational dashboard for administrators.
 *
 * Reads pre-aggregated stats from /api/admin/dashboard and presents them as:
 *   - One system-status callout (the lede — plain-language summary of the day)
 *   - Three "today" tiles in a single row (Sessions, Workflow runs, PII)
 *   - One goa-tabs strip with four deep-dive tabs: Sessions, Workflows,
 *     Models, PII. Each tab shows one well-built breakdown, not four small
 *     identical ones.
 *
 * Refresh cadence: every 60s while the tab is active. Stale state surfaces
 * when more than 5 minutes have passed since the last successful fetch.
 */
import { computed, onActivated, onDeactivated, onBeforeUnmount, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import type {
  DashboardSummary,
  DashboardStatusBreakdown,
  DashboardClassificationBreakdown,
  DashboardModelUsage,
} from '@/types/admin'

const data = ref<DashboardSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const lastFetched = ref<Date | null>(null)
const now = ref(Date.now())

const POLL_INTERVAL_MS = 60_000
const STALE_AFTER_MS = 5 * 60_000
let pollHandle: ReturnType<typeof setInterval> | null = null
let clockHandle: ReturnType<typeof setInterval> | null = null

const activeTab = ref<'sessions' | 'workflows' | 'models' | 'pii'>('sessions')

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
  if (!pollHandle) pollHandle = setInterval(() => void load(), POLL_INTERVAL_MS)
  if (!clockHandle) clockHandle = setInterval(() => (now.value = Date.now()), 30_000)
}

function stopPolling(): void {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
  if (clockHandle) {
    clearInterval(clockHandle)
    clockHandle = null
  }
}

void load()
startPolling()
onActivated(() => {
  void load()
  startPolling()
})
onDeactivated(stopPolling)
onBeforeUnmount(stopPolling)

// -- Tile inputs ------------------------------------------------------------
// The backend returns three windows (24h / 7d / 30d) for sessions and runs.
// We treat "24h" as today and compute a 7-day daily average from the 7d total
// so the tile delta line stays honest. PII is only available as a 7-day total,
// so its tile label says "last 7 days" — no fake "today" framing.

function windowCount(
  totals: DashboardSummary['sessions']['totals'],
  label: '24h' | '7d' | '30d',
): number {
  return totals.find((t) => t.windowLabel === label)?.count ?? 0
}

function deltaLine(today: number, sevenDay: number): { text: string; tone: 'up' | 'down' | 'flat' | 'first' } {
  if (sevenDay <= 0) {
    return today > 0
      ? { text: 'First activity today', tone: 'first' }
      : { text: 'No activity in the last 7 days', tone: 'flat' }
  }
  const avg = sevenDay / 7
  if (avg === 0) {
    return { text: today > 0 ? 'First activity today' : 'No activity yet', tone: 'first' }
  }
  const pct = Math.round(((today - avg) / avg) * 100)
  if (pct === 0) return { text: 'No change vs 7-day avg', tone: 'flat' }
  if (pct > 0) return { text: `+${pct}% vs 7-day avg`, tone: 'up' }
  return { text: `${pct}% vs 7-day avg`, tone: 'down' }
}

const sessionsToday = computed(() => (data.value ? windowCount(data.value.sessions.totals, '24h') : 0))
const sessions7d = computed(() => (data.value ? windowCount(data.value.sessions.totals, '7d') : 0))
const runsToday = computed(() => (data.value ? windowCount(data.value.workflowExecutions.totals, '24h') : 0))
const runs7d = computed(() => (data.value ? windowCount(data.value.workflowExecutions.totals, '7d') : 0))
const piiSevenDay = computed(() => data.value?.pii.last7Days ?? 0)

const sessionsDelta = computed(() => deltaLine(sessionsToday.value, sessions7d.value))
const runsDelta = computed(() => deltaLine(runsToday.value, runs7d.value))

// -- System status callout -------------------------------------------------
// Plain-language summary of the day. Composes from the available counts plus
// the running session-by-status table to spot failed runs.

const failedSessionsCount = computed(() => {
  const row = data.value?.sessions.byStatus.find((r) => r.status === 'error')
  return row?.count ?? 0
})

const failedRunsCount = computed(() => {
  const row = data.value?.workflowExecutions.byStatus.find((r) => r.status === 'error')
  return row?.count ?? 0
})

interface SystemStatus {
  tone: 'success' | 'information' | 'important' | 'emergency'
  heading: string
  body: string
}

const systemStatus = computed<SystemStatus>(() => {
  if (!data.value) {
    return {
      tone: 'information',
      heading: 'Status',
      body: 'Loading operational summary…',
    }
  }
  const sentence = `${sessionsToday.value} session${sessionsToday.value === 1 ? '' : 's'}, ${runsToday.value} workflow run${runsToday.value === 1 ? '' : 's'} today. ${piiSevenDay.value} PII pattern${piiSevenDay.value === 1 ? '' : 's'} blocked in the last 7 days.`
  if (failedRunsCount.value > 0 || failedSessionsCount.value > 0) {
    return {
      tone: 'important',
      heading: 'Needs attention',
      body: `${sentence} ${failedRunsCount.value > 0 ? `${failedRunsCount.value} workflow run${failedRunsCount.value === 1 ? '' : 's'} failed in the last 30 days.` : ''} Review under Workflows.`.trim(),
    }
  }
  if (piiSevenDay.value > 0) {
    return {
      tone: 'information',
      heading: 'All systems nominal',
      body: `${sentence} Review PII activity below if needed.`,
    }
  }
  return {
    tone: 'success',
    heading: 'All systems nominal',
    body: sentence,
  }
})

// -- Tab data --------------------------------------------------------------

const sessionsByStatus = computed<DashboardStatusBreakdown[]>(() => data.value?.sessions.byStatus ?? [])
const sessionsByClassification = computed<DashboardClassificationBreakdown[]>(() => data.value?.sessions.byClassification ?? [])
const workflowsByStatus = computed<DashboardStatusBreakdown[]>(() => data.value?.workflowExecutions.byStatus ?? [])
const models = computed<DashboardModelUsage[]>(() => data.value?.models ?? [])
const tools = computed(() => data.value?.tools ?? [])
const piiByType = computed(() => data.value?.pii.byType ?? [])
const piiByAction = computed(() => data.value?.pii.byAction ?? [])

function totalOf<T extends { count: number }>(rows: T[]): number {
  return rows.reduce((sum, r) => sum + r.count, 0)
}

const sessionsByStatusTotal = computed(() => totalOf(sessionsByStatus.value))
const sessionsByClassificationTotal = computed(() => totalOf(sessionsByClassification.value))
const workflowsByStatusTotal = computed(() => totalOf(workflowsByStatus.value))
const modelsTotal = computed(() => models.value.reduce((sum, m) => sum + m.sessions, 0))
const toolsTotal = computed(() => tools.value.reduce((sum, t) => sum + t.calls, 0))

function pct(value: number, total: number): number {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

function successRate(t: { calls: number; successes: number }): string {
  if (!t.calls) return '—'
  return `${Math.round((t.successes / t.calls) * 100)}%`
}

// -- Freshness -------------------------------------------------------------
const isStale = computed(() => {
  if (!lastFetched.value) return false
  return now.value - lastFetched.value.getTime() > STALE_AFTER_MS
})

function formatFetched(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-CA')
}

function setTab(name: typeof activeTab.value): void {
  activeTab.value = name
}

function statusLabel(status: string): string {
  // Render raw enum values in a readable shape for the byStatus breakdowns.
  const map: Record<string, string> = {
    needs_assistance: 'Needs assistance',
    protected_a: 'Protected A',
    protected_b: 'Protected B',
  }
  return map[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')
}
</script>

<template>
  <section aria-label="Operational dashboard" class="space-y-5">
    <header class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h2 class="text-2xl font-bold text-[var(--goa-color-text-default)] m-0">Dashboard</h2>
        <p class="text-sm text-[var(--goa-color-text-secondary)] mt-1 m-0">
          Operational summary for the Agent Builder Console.
        </p>
      </div>
      <div class="flex items-center gap-3 text-xs text-[var(--goa-color-text-secondary)]">
        <goa-badge v-if="isStale" type="important" content="stale"></goa-badge>
        <span v-if="lastFetched" aria-live="polite">
          Updated {{ formatFetched(lastFetched) }}
        </span>
        <goa-button type="tertiary" size="compact" leadingicon="refresh" :disabled="loading || undefined" @_click="load">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </goa-button>
      </div>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load dashboard">
      {{ error }}
    </goa-callout>

    <!-- 1. System status — the lede -->
    <goa-callout
      v-if="data"
      :type="systemStatus.tone"
      :heading="systemStatus.heading"
    >
      {{ systemStatus.body }}
    </goa-callout>

    <!-- 2. Three "today" tiles. Single row, glanceable. -->
    <div v-if="data" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <goa-container type="non-interactive" padding="relaxed">
        <div class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
          Sessions today
        </div>
        <div class="text-4xl font-semibold mt-1 text-[var(--goa-color-text-default)]">
          {{ formatNumber(sessionsToday) }}
        </div>
        <div class="text-sm mt-2 text-[var(--goa-color-text-secondary)]">
          {{ sessionsDelta.text }}
        </div>
      </goa-container>

      <goa-container type="non-interactive" padding="relaxed">
        <div class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
          Workflow runs today
        </div>
        <div class="text-4xl font-semibold mt-1 text-[var(--goa-color-text-default)]">
          {{ formatNumber(runsToday) }}
        </div>
        <div class="text-sm mt-2 text-[var(--goa-color-text-secondary)]">
          {{ runsDelta.text }}
        </div>
      </goa-container>

      <goa-container type="non-interactive" padding="relaxed">
        <div class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
          PII blocked · last 7 days
        </div>
        <div class="text-4xl font-semibold mt-1 text-[var(--goa-color-text-default)]">
          {{ formatNumber(piiSevenDay) }}
        </div>
        <div class="text-sm mt-2 text-[var(--goa-color-text-secondary)]">
          {{ piiSevenDay === 0 ? 'No PII patterns blocked.' : 'Review under PII tab below.' }}
        </div>
      </goa-container>
    </div>

    <!-- First-paint skeleton row when there is no data yet. -->
    <div v-else-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      <goa-skeleton type="card" v-for="i in 3" :key="i"></goa-skeleton>
    </div>

    <!-- 3. Deep-dive tabs. One well-built thing per tab. -->
    <div v-if="data" role="tablist" class="flex items-center gap-1 border-b border-[var(--goa-color-border)]">
      <button
        v-for="tab in [
          { id: 'sessions',  label: 'Sessions' },
          { id: 'workflows', label: 'Workflows' },
          { id: 'models',    label: 'Models' },
          { id: 'pii',       label: 'PII' },
        ] as const"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :class="[
          'relative px-4 py-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded-t',
          activeTab === tab.id
            ? 'text-[var(--goa-color-primary-dark)] after:content-[\'\'] after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-[var(--goa-color-primary)]'
            : 'text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text-default)]',
        ]"
        @click="setTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Sessions tab -->
    <goa-container v-if="data && activeTab === 'sessions'" type="non-interactive" padding="relaxed">
      <header class="flex items-baseline justify-between mb-3">
        <h3 class="text-base font-semibold m-0 text-[var(--goa-color-text-default)]">Sessions · last 30 days</h3>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">
          {{ formatNumber(sessionsByStatusTotal) }} total
        </span>
      </header>
      <ul v-if="sessionsByStatus.length > 0" class="space-y-3">
        <li v-for="row in sessionsByStatus" :key="row.status">
          <div class="flex items-center justify-between text-sm">
            <span>{{ statusLabel(row.status) }}</span>
            <span class="text-[var(--goa-color-text-secondary)] text-xs">
              {{ formatNumber(row.count) }} ({{ pct(row.count, sessionsByStatusTotal) }}%)
            </span>
          </div>
          <goa-linear-progress
            :value="pct(row.count, sessionsByStatusTotal)"
            :ariavaluenowmin="0"
            :ariavaluenowmax="100"
          ></goa-linear-progress>
        </li>
      </ul>
      <p v-else class="text-sm text-[var(--goa-color-text-secondary)] m-0">
        No sessions in the last 30 days.
      </p>

      <div class="mt-6">
        <h4 class="text-sm font-semibold text-[var(--goa-color-text-default)] mb-2 m-0">By classification</h4>
        <ul v-if="sessionsByClassification.length > 0" class="space-y-3">
          <li v-for="row in sessionsByClassification" :key="row.classification">
            <div class="flex items-center justify-between text-sm">
              <span>{{ statusLabel(row.classification) }}</span>
              <span class="text-[var(--goa-color-text-secondary)] text-xs">
                {{ formatNumber(row.count) }} ({{ pct(row.count, sessionsByClassificationTotal) }}%)
              </span>
            </div>
            <goa-linear-progress
              :value="pct(row.count, sessionsByClassificationTotal)"
              :ariavaluenowmin="0"
              :ariavaluenowmax="100"
            ></goa-linear-progress>
          </li>
        </ul>
      </div>
    </goa-container>

    <!-- Workflows tab -->
    <goa-container v-else-if="data && activeTab === 'workflows'" type="non-interactive" padding="relaxed">
      <header class="flex items-baseline justify-between mb-3">
        <h3 class="text-base font-semibold m-0 text-[var(--goa-color-text-default)]">Workflow runs · last 30 days</h3>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">
          {{ formatNumber(workflowsByStatusTotal) }} total
        </span>
      </header>
      <ul v-if="workflowsByStatus.length > 0" class="space-y-3">
        <li v-for="row in workflowsByStatus" :key="row.status">
          <div class="flex items-center justify-between text-sm">
            <span>{{ statusLabel(row.status) }}</span>
            <span class="text-[var(--goa-color-text-secondary)] text-xs">
              {{ formatNumber(row.count) }} ({{ pct(row.count, workflowsByStatusTotal) }}%)
            </span>
          </div>
          <goa-linear-progress
            :value="pct(row.count, workflowsByStatusTotal)"
            :ariavaluenowmin="0"
            :ariavaluenowmax="100"
          ></goa-linear-progress>
        </li>
      </ul>
      <p v-else class="text-sm text-[var(--goa-color-text-secondary)] m-0">
        No workflow runs in the last 30 days.
      </p>

      <div v-if="tools.length > 0" class="mt-6">
        <h4 class="text-sm font-semibold text-[var(--goa-color-text-default)] mb-2 m-0">
          Top tools · last 7 days
        </h4>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mb-2 m-0">
          {{ formatNumber(toolsTotal) }} total tool calls
        </p>
        <goa-table width="100%" variant="normal" version="2">
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
              <td class="text-right text-sm">{{ formatNumber(t.calls) }}</td>
              <td class="text-right text-sm">{{ formatNumber(t.successes) }}</td>
              <td class="text-right text-sm">{{ successRate(t) }}</td>
              <td class="text-right text-sm">{{ pct(t.calls, toolsTotal) }}%</td>
            </tr>
          </tbody>
        </goa-table>
      </div>
    </goa-container>

    <!-- Models tab -->
    <goa-container v-else-if="data && activeTab === 'models'" type="non-interactive" padding="relaxed">
      <header class="flex items-baseline justify-between mb-3">
        <h3 class="text-base font-semibold m-0 text-[var(--goa-color-text-default)]">Model usage · last 30 days</h3>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">
          {{ formatNumber(modelsTotal) }} total sessions
        </span>
      </header>
      <ul v-if="models.length > 0" class="space-y-3">
        <li v-for="row in models" :key="row.modelId">
          <div class="flex items-center justify-between text-sm">
            <span class="font-mono text-xs">{{ row.modelId }}</span>
            <span class="text-[var(--goa-color-text-secondary)] text-xs">
              {{ formatNumber(row.sessions) }} ({{ pct(row.sessions, modelsTotal) }}%)
            </span>
          </div>
          <goa-linear-progress
            :value="pct(row.sessions, modelsTotal)"
            :ariavaluenowmin="0"
            :ariavaluenowmax="100"
          ></goa-linear-progress>
        </li>
      </ul>
      <p v-else class="text-sm text-[var(--goa-color-text-secondary)] m-0">
        No model usage in the last 30 days.
      </p>
    </goa-container>

    <!-- PII tab -->
    <goa-container v-else-if="data && activeTab === 'pii'" type="non-interactive" padding="relaxed">
      <header class="flex items-baseline justify-between mb-3">
        <h3 class="text-base font-semibold m-0 text-[var(--goa-color-text-default)]">PII detections · last 7 days</h3>
        <span class="text-xs text-[var(--goa-color-text-secondary)]">
          {{ formatNumber(piiSevenDay) }} total
        </span>
      </header>

      <p v-if="piiSevenDay === 0" class="text-sm text-[var(--goa-color-text-secondary)] m-0">
        No PII patterns matched in the last 7 days.
      </p>
      <div v-else class="grid gap-6 md:grid-cols-2">
        <div>
          <h4 class="text-sm font-semibold text-[var(--goa-color-text-default)] mb-2 m-0">By type</h4>
          <ul class="space-y-1">
            <li
              v-for="row in piiByType"
              :key="row.detectionType"
              class="flex items-center justify-between text-sm"
            >
              <span class="font-mono text-xs">{{ row.detectionType }}</span>
              <span class="text-[var(--goa-color-text-secondary)] text-xs">{{ formatNumber(row.count) }}</span>
            </li>
          </ul>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-[var(--goa-color-text-default)] mb-2 m-0">By action</h4>
          <ul class="space-y-1">
            <li
              v-for="row in piiByAction"
              :key="row.action"
              class="flex items-center justify-between text-sm"
            >
              <span>{{ statusLabel(row.action) }}</span>
              <span class="text-[var(--goa-color-text-secondary)] text-xs">{{ formatNumber(row.count) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </goa-container>
  </section>
</template>
