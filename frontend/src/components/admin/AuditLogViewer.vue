<script setup lang="ts">
import { computed, ref, onActivated } from 'vue'
import { api, ApiError } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import type { AuditEntry } from '@/types/admin'

const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const filterAction = ref('')
const filterUserId = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const filterLimit = ref(100)

const toast = useToast()

// FOIP s.7 export state. The button is only meaningful when a single user is
// in the filter — bulk exports are intentionally not exposed from this view.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const exportConfirmOpen = ref(false)
const exportInFlight = ref(false)

const canExportUser = computed(() => UUID_RE.test(filterUserId.value.trim()))

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

function openExportConfirm(): void {
  if (!canExportUser.value) return
  exportConfirmOpen.value = true
}

function cancelExport(): void {
  exportConfirmOpen.value = false
}

async function confirmExportUserData(): Promise<void> {
  if (!canExportUser.value || exportInFlight.value) return
  exportInFlight.value = true
  try {
    const targetUserId = filterUserId.value.trim()
    const { blob, filename } = await api.admin.exportUserData(targetUserId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    exportConfirmOpen.value = false
    toast.push({
      kind: 'success',
      message: `User data exported (${filename}).`,
    })
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Export failed: ${message}` })
  } finally {
    exportInFlight.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-text-default)]">Audit Log</h3>
        <p
          v-if="!loading"
          class="text-xs text-[var(--goa-color-text-secondary)] mt-1"
          aria-live="polite"
        >
          {{ entries.length }} {{ entries.length === 1 ? 'entry' : 'entries' }}
          <span v-if="entries.length === filterLimit"> (limit reached — increase to see more)</span>
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <goa-button type="primary" size="compact" leadingicon="search" @_click="load">
          {{ entries.length === 0 ? 'Search' : 'Apply filters' }}
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
        <goa-button
          type="secondary"
          size="compact"
          leadingicon="folder-open"
          data-testid="export-user-data"
          :disabled="!canExportUser || undefined"
          :title="canExportUser
            ? 'FOIP s.7 right-of-access: download a ZIP of all data attributable to this user.'
            : 'Enter a valid user UUID above to enable.'"
          @_click="openExportConfirm"
        >
          Export user data
        </goa-button>
      </div>
    </header>

    <!-- Filters -->
    <goa-container type="non-interactive" padding="relaxed">
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
      <goa-form-item label="Action">
        <goa-input
          name="filterAction"
          :value="filterAction"
          placeholder="e.g. admin.access"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterAction = e.detail.value)"
          @_keypress="(e: CustomEvent<{ key: string }>) => e.detail.key === 'Enter' && load()"
        ></goa-input>
      </goa-form-item>
      <goa-form-item label="User ID">
        <goa-input
          name="filterUserId"
          :value="filterUserId"
          placeholder="UUID"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (filterUserId = e.detail.value)"
          @_keypress="(e: CustomEvent<{ key: string }>) => e.detail.key === 'Enter' && load()"
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
          @_keypress="(e: CustomEvent<{ key: string }>) => e.detail.key === 'Enter' && load()"
        ></goa-input>
      </goa-form-item>
    </div>
    </goa-container>

    <goa-callout v-if="error" type="emergency" heading="Audit query failed">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Time</th>
          <th>Action</th>
          <th>User</th>
          <th>Resource</th>
          <th>IP</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="6" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="entries.length === 0">
          <td colspan="6" class="text-center">No audit entries match the filters.</td>
        </tr>
        <tr v-for="entry in entries" :key="entry.id">
          <td class="whitespace-nowrap font-mono text-xs">{{ new Date(entry.created_at).toLocaleString() }}</td>
          <td class="font-mono text-xs">{{ entry.action }}</td>
          <td class="font-mono text-xs">{{ entry.user_id ?? '—' }}</td>
          <td class="text-xs">{{ entry.resource_type ?? '—' }}<span v-if="entry.resource_id">/{{ entry.resource_id }}</span></td>
          <td class="font-mono text-xs">{{ entry.ip_address ?? '—' }}</td>
          <td class="text-xs max-w-xs truncate">{{ entry.details ? JSON.stringify(entry.details) : '—' }}</td>
        </tr>
      </tbody>
    </goa-table>

    <!--
      FOIP s.7 right-of-access export: produces a ZIP of all data attributable
      to a single user. Gated behind a confirm modal because it's an
      irreversible disclosure event that itself is audit-logged.
    -->
    <goa-modal
      v-if="exportConfirmOpen"
      open
      heading="Export user data (FOIP s.7)"
      role="alertdialog"
      data-testid="export-user-data-modal"
      @_close="exportInFlight ? null : cancelExport()"
    >
      <p>
        This will produce a ZIP of every record attributable to user
        <code class="font-mono text-xs">{{ filterUserId.trim() }}</code>.
        The export itself is audit-logged as
        <code class="font-mono text-xs">user.data.exported</code>.
      </p>
      <div slot="actions" class="flex justify-end gap-2">
        <goa-button
          type="secondary"
          :disabled="exportInFlight || undefined"
          @_click="cancelExport"
        >
          Cancel
        </goa-button>
        <goa-button
          type="primary"
          data-testid="export-user-data-confirm"
          :disabled="exportInFlight || undefined"
          @_click="confirmExportUserData"
        >
          {{ exportInFlight ? 'Exporting…' : 'Export user data' }}
        </goa-button>
      </div>
    </goa-modal>
  </div>
</template>