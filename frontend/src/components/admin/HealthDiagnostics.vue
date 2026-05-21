<script setup lang="ts">
import { ref, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { HealthDetailed, RetentionReport } from '@/types/admin'

const data = ref<HealthDetailed | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const lastFetched = ref<Date | null>(null)
const retentionRunning = ref(false)
const retentionReport = ref<RetentionReport | null>(null)

const POLL_INTERVAL_MS = 30_000
let pollHandle: ReturnType<typeof setInterval> | null = null

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await api.health.detailed()
    lastFetched.value = new Date()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function runRetention() {
  retentionRunning.value = true
  retentionReport.value = null
  try {
    const result = await api.admin.runRetention()
    retentionReport.value = result.report
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    retentionRunning.value = false
  }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${d}d ${h}h ${m}m ${s}s`
}

function startPolling() {
  if (pollHandle) return
  pollHandle = setInterval(load, POLL_INTERVAL_MS)
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
}

// onActivated fires on first KeepAlive mount AND every subsequent re-activation,
// so it covers both initial render and tab-revisit. Using onMounted alongside
// would double-call load() on first mount.
onActivated(() => {
  load()
  startPolling()
})
onDeactivated(stopPolling)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Health Diagnostics</h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Auto-refreshes every 30s. Last fetched: {{ lastFetched ? lastFetched.toLocaleTimeString() : 'never' }}
        </p>
      </div>
      <button
        @click="load"
        class="px-3 py-1.5 text-sm font-medium bg-[var(--goa-color-primary)] text-white rounded hover:bg-[var(--goa-color-primary-dark)]"
      >
        Refresh now
      </button>
    </header>

    <div v-if="error" class="p-3 bg-red-50 border border-[var(--goa-color-error)] text-[var(--goa-color-error)] text-sm rounded">
      {{ error }}
    </div>

    <div v-if="data" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Status -->
      <section class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded p-4">
        <h4 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] mb-3">Runtime</h4>
        <dl class="text-sm space-y-1">
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Status</dt><dd class="font-medium" :class="data.status === 'healthy' ? 'text-[var(--goa-color-success)]' : 'text-[var(--goa-color-error)]'">{{ data.status }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Uptime</dt><dd class="font-mono text-xs">{{ formatUptime(data.uptimeSeconds) }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Version</dt><dd class="font-mono text-xs">{{ data.version }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Node</dt><dd class="font-mono text-xs">{{ data.nodeVersion }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Environment</dt><dd class="font-mono text-xs">{{ data.environment }}</dd></div>
        </dl>
      </section>

      <!-- Memory -->
      <section class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded p-4">
        <h4 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] mb-3">Memory</h4>
        <dl class="text-sm space-y-1">
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">RSS</dt><dd class="font-mono text-xs">{{ data.memory.rssMb }} MB</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Heap used</dt><dd class="font-mono text-xs">{{ data.memory.heapUsedMb }} MB</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Heap total</dt><dd class="font-mono text-xs">{{ data.memory.heapTotalMb }} MB</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">External</dt><dd class="font-mono text-xs">{{ data.memory.externalMb }} MB</dd></div>
        </dl>
      </section>

      <!-- Pool -->
      <section class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded p-4">
        <h4 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] mb-3">Database Pool</h4>
        <dl class="text-sm space-y-1">
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Total</dt><dd class="font-mono text-xs">{{ data.pool.totalCount }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Idle</dt><dd class="font-mono text-xs">{{ data.pool.idleCount }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Waiting</dt><dd class="font-mono text-xs">{{ data.pool.waitingCount }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Queries</dt><dd class="font-mono text-xs">{{ data.pool.queryCount }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Slow queries</dt><dd class="font-mono text-xs">{{ data.pool.slowQueryCount }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Errors</dt><dd class="font-mono text-xs">{{ data.pool.errorCount }}</dd></div>
        </dl>
      </section>

      <!-- Tokens -->
      <section class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded p-4">
        <h4 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] mb-3">LLM Token Usage ({{ data.tokens.windowMinutes }} min window)</h4>
        <dl class="text-sm space-y-1">
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Calls</dt><dd class="font-mono text-xs">{{ data.tokens.callCount }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Prompt tokens</dt><dd class="font-mono text-xs">{{ data.tokens.totalPromptTokens.toLocaleString() }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Completion tokens</dt><dd class="font-mono text-xs">{{ data.tokens.totalCompletionTokens.toLocaleString() }}</dd></div>
        </dl>
      </section>

      <!-- Services -->
      <section class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded p-4">
        <h4 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] mb-3">Configured Services</h4>
        <dl class="text-sm space-y-1">
          <div v-for="(value, name) in data.services" :key="name" class="flex justify-between">
            <dt class="text-[var(--goa-color-text-secondary)]">{{ name }}</dt>
            <dd class="font-mono text-xs" :class="value === 'configured' || value === 'connected' ? 'text-[var(--goa-color-success)]' : 'text-[var(--goa-color-text-secondary)]'">{{ value }}</dd>
          </div>
        </dl>
      </section>

      <!-- Retention -->
      <section class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded p-4">
        <h4 class="text-sm font-semibold text-[var(--goa-color-primary-dark)] mb-3">Retention Job</h4>
        <dl class="text-sm space-y-1 mb-3">
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Scheduler</dt><dd class="font-mono text-xs">{{ data.retention.enabled ? 'enabled' : 'disabled' }}</dd></div>
          <div class="flex justify-between"><dt class="text-[var(--goa-color-text-secondary)]">Daily hour</dt><dd class="font-mono text-xs">{{ data.retention.hour }}:00</dd></div>
        </dl>
        <button
          @click="runRetention"
          :disabled="retentionRunning"
          class="w-full px-3 py-1.5 text-sm font-medium border border-[var(--goa-color-border)] rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {{ retentionRunning ? 'Running…' : 'Run retention pass now' }}
        </button>
        <div v-if="retentionReport" class="mt-3 text-xs bg-gray-50 rounded p-2">
          <div>Affected: <span class="font-mono">{{ retentionReport.totalRowsAffected }}</span> rows in <span class="font-mono">{{ retentionReport.durationMs }}ms</span></div>
          <ul class="mt-1 space-y-0.5">
            <li v-for="r in retentionReport.byTable" :key="`${r.table}-${r.classification}`" class="font-mono">
              {{ r.table }} / {{ r.classification }} ({{ r.strategy }}): {{ r.rowsAffected }}
            </li>
          </ul>
          <div v-if="retentionReport.errors.length" class="mt-1 text-[var(--goa-color-error)]">
            Errors: {{ retentionReport.errors.join('; ') }}
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="loading" class="text-center text-[var(--goa-color-text-secondary)] py-8">Loading…</div>
  </div>
</template>
