<script setup lang="ts">
import { ref, onActivated } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { AuditEntry } from '@/types/admin'

const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const filterAction = ref('')
const filterUserId = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const filterLimit = ref(100)

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await api.admin.audit({
      action: filterAction.value || undefined,
      user_id: filterUserId.value || undefined,
      from: filterFrom.value ? new Date(filterFrom.value).toISOString() : undefined,
      to: filterTo.value ? new Date(filterTo.value).toISOString() : undefined,
      limit: filterLimit.value,
    })
    entries.value = result.entries
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function exportCsv() {
  const headers = ['id', 'created_at', 'action', 'user_id', 'ministry_code', 'resource_type', 'resource_id', 'ip_address', 'details']
  const rows = entries.value.map((e) =>
    headers.map((h) => escapeCsv((e as Record<string, unknown>)[h])).join(','),
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Load once on first activation. Subsequent KeepAlive re-activations preserve
// the user's last filter + result set; use the Refresh button to re-query.
let loaded = false
onActivated(() => {
  if (!loaded) {
    loaded = true
    load()
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Audit Log</h3>
      <div class="flex gap-2">
        <goa-button type="primary" size="compact" leadingicon="refresh" @_click="load">
          Refresh
        </goa-button>
        <goa-button
          type="secondary"
          size="compact"
          leadingicon="download"
          :disabled="entries.length === 0 || undefined"
          @_click="exportCsv"
        >
          Export CSV
        </goa-button>
      </div>
    </header>

    <!-- Filters -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded">
      <goa-form-item label="Action">
        <goa-input
          name="filterAction"
          :value="filterAction"
          placeholder="e.g. admin.access"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterAction = e.detail.value)"
        ></goa-input>
      </goa-form-item>
      <goa-form-item label="User ID">
        <goa-input
          name="filterUserId"
          :value="filterUserId"
          placeholder="UUID"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterUserId = e.detail.value)"
        ></goa-input>
      </goa-form-item>
      <goa-form-item label="From">
        <goa-input
          name="filterFrom"
          type="datetime-local"
          :value="filterFrom"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterFrom = e.detail.value)"
        ></goa-input>
      </goa-form-item>
      <goa-form-item label="To">
        <goa-input
          name="filterTo"
          type="datetime-local"
          :value="filterTo"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterTo = e.detail.value)"
        ></goa-input>
      </goa-form-item>
      <goa-form-item label="Limit">
        <goa-input
          name="filterLimit"
          type="number"
          :value="String(filterLimit)"
          min="1"
          max="500"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterLimit = Number(e.detail.value) || 100)"
        ></goa-input>
      </goa-form-item>
    </div>

    <goa-callout v-if="error" type="emergency" heading="Audit query failed">
      {{ error }}
    </goa-callout>

    <div class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]">
          <tr>
            <th class="text-left px-3 py-2 font-semibold">Time</th>
            <th class="text-left px-3 py-2 font-semibold">Action</th>
            <th class="text-left px-3 py-2 font-semibold">User</th>
            <th class="text-left px-3 py-2 font-semibold">Resource</th>
            <th class="text-left px-3 py-2 font-semibold">IP</th>
            <th class="text-left px-3 py-2 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">Loading…</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="6" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">No audit entries match the filters.</td>
          </tr>
          <tr v-for="entry in entries" :key="entry.id" class="border-t border-[var(--goa-color-border)] hover:bg-gray-50">
            <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">{{ new Date(entry.created_at).toLocaleString() }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ entry.action }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ entry.user_id ?? '—' }}</td>
            <td class="px-3 py-2 text-xs">{{ entry.resource_type ?? '—' }}<span v-if="entry.resource_id">/{{ entry.resource_id }}</span></td>
            <td class="px-3 py-2 font-mono text-xs">{{ entry.ip_address ?? '—' }}</td>
            <td class="px-3 py-2 text-xs max-w-xs truncate">{{ entry.details ? JSON.stringify(entry.details) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
