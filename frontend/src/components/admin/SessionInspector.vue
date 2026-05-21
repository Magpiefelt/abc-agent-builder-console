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

    <div class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]">
          <tr>
            <th class="text-left px-3 py-2 font-semibold">Status</th>
            <th class="text-left px-3 py-2 font-semibold">Session ID</th>
            <th class="text-left px-3 py-2 font-semibold">Model</th>
            <th class="text-left px-3 py-2 font-semibold">Classification</th>
            <th class="text-left px-3 py-2 font-semibold">Iterations</th>
            <th class="text-left px-3 py-2 font-semibold">User</th>
            <th class="text-left px-3 py-2 font-semibold">Ministry</th>
            <th class="text-left px-3 py-2 font-semibold">Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">Loading…</td>
          </tr>
          <tr v-else-if="sessions.length === 0">
            <td colspan="8" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">No sessions found.</td>
          </tr>
          <tr v-for="s in sessions" :key="s.id" class="border-t border-[var(--goa-color-border)] hover:bg-gray-50">
            <td class="px-3 py-2">
              <goa-badge :type="statusBadgeType(s.status)" :content="s.status"></goa-badge>
            </td>
            <td class="px-3 py-2 font-mono text-xs">{{ s.id.slice(0, 8) }}…</td>
            <td class="px-3 py-2 font-mono text-xs">{{ s.model_id }}</td>
            <td class="px-3 py-2 text-xs">{{ s.classification }}</td>
            <td class="px-3 py-2 text-xs">{{ s.current_iteration }} / {{ s.max_iterations }}</td>
            <td class="px-3 py-2 text-xs">{{ s.user_display_name || s.user_email || s.user_id }}</td>
            <td class="px-3 py-2 text-xs">{{ s.ministry_code ?? '—' }}</td>
            <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">{{ new Date(s.created_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
