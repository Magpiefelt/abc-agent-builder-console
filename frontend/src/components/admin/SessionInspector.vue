<script setup lang="ts">
import { ref, onActivated } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { SessionSummary, SessionStatus } from '@/types/admin'

const sessions = ref<SessionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const statusFilter = ref<string>('')

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await api.admin.sessions({
      status: statusFilter.value || undefined,
      limit: 100,
    })
    sessions.value = result.sessions
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function statusBadgeType(status: SessionStatus): 'information' | 'success' | 'emergency' | 'important' | 'midtone' {
  switch (status) {
    case 'running':
      return 'information'
    case 'completed':
      return 'success'
    case 'error':
      return 'emergency'
    case 'needs_assistance':
    case 'paused':
      return 'important'
    default:
      return 'midtone'
  }
}

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
      <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Sessions</h3>
      <div class="flex items-center gap-2">
        <goa-dropdown
          name="statusFilter"
          :value="statusFilter"
          width="14rem"
          @_change="(e: CustomEvent<{ value: string }>) => { statusFilter = e.detail.value; load() }"
        >
          <goa-dropdown-item value="" label="All statuses"></goa-dropdown-item>
          <goa-dropdown-item value="idle" label="Idle"></goa-dropdown-item>
          <goa-dropdown-item value="running" label="Running"></goa-dropdown-item>
          <goa-dropdown-item value="paused" label="Paused"></goa-dropdown-item>
          <goa-dropdown-item value="completed" label="Completed"></goa-dropdown-item>
          <goa-dropdown-item value="error" label="Error"></goa-dropdown-item>
          <goa-dropdown-item value="needs_assistance" label="Needs assistance"></goa-dropdown-item>
        </goa-dropdown>
        <goa-button type="primary" size="compact" leadingicon="refresh" @_click="load">
          Refresh
        </goa-button>
      </div>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load sessions">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Status</th>
          <th>Session ID</th>
          <th>Model</th>
          <th>Classification</th>
          <th>Iterations</th>
          <th>User</th>
          <th>Ministry</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="sessions.length === 0">
          <td colspan="8" class="text-center">No sessions found.</td>
        </tr>
        <tr v-for="s in sessions" :key="s.id">
          <td>
            <goa-badge :type="statusBadgeType(s.status)" :content="s.status"></goa-badge>
          </td>
          <td class="font-mono text-xs">{{ s.id.slice(0, 8) }}…</td>
          <td class="font-mono text-xs">{{ s.model_id }}</td>
          <td class="text-xs">{{ s.classification }}</td>
          <td class="text-xs">{{ s.current_iteration }} / {{ s.max_iterations }}</td>
          <td class="text-xs">{{ s.user_display_name || s.user_email || s.user_id }}</td>
          <td class="text-xs">{{ s.ministry_code ?? '—' }}</td>
          <td class="whitespace-nowrap font-mono text-xs">{{ new Date(s.created_at).toLocaleString() }}</td>
        </tr>
      </tbody>
    </goa-table>
  </div>
</template>
