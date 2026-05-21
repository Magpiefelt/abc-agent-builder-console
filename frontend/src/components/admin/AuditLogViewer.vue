<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

function exportCsv() {
  const headers = ['id', 'created_at', 'action', 'user_id', 'ministry_code', 'resource_type', 'resource_id', 'ip_address']
  const rows = entries.value.map((e) =>
    headers.map((h) => JSON.stringify((e as Record<string, unknown>)[h] ?? '')).join(','),
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Audit Log</h3>
      <div class="flex gap-2">
        <button
          @click="load"
          class="px-3 py-1.5 text-sm font-medium bg-[var(--goa-color-primary)] text-white rounded hover:bg-[var(--goa-color-primary-dark)]"
        >
          Refresh
        </button>
        <button
          @click="exportCsv"
          :disabled="entries.length === 0"
          class="px-3 py-1.5 text-sm font-medium border border-[var(--goa-color-border)] rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>
    </header>

    <!-- Filters -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">Action</label>
        <input
          v-model="filterAction"
          placeholder="e.g. admin.access"
          class="px-2 py-1 border border-[var(--goa-color-border)] rounded text-sm"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">User ID</label>
        <input
          v-model="filterUserId"
          placeholder="UUID"
          class="px-2 py-1 border border-[var(--goa-color-border)] rounded text-sm"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">From</label>
        <input v-model="filterFrom" type="datetime-local" class="px-2 py-1 border border-[var(--goa-color-border)] rounded text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">To</label>
        <input v-model="filterTo" type="datetime-local" class="px-2 py-1 border border-[var(--goa-color-border)] rounded text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">Limit</label>
        <input v-model.number="filterLimit" type="number" min="1" max="500" class="px-2 py-1 border border-[var(--goa-color-border)] rounded text-sm" />
      </div>
    </div>

    <div v-if="error" class="p-3 bg-red-50 border border-[var(--goa-color-error)] text-[var(--goa-color-error)] text-sm rounded">
      {{ error }}
    </div>

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
