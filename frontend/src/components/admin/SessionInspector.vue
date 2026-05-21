<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

function statusClass(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-100 text-[var(--goa-color-info)]'
    case 'completed':
      return 'bg-green-100 text-[var(--goa-color-success)]'
    case 'error':
      return 'bg-red-100 text-[var(--goa-color-error)]'
    case 'needs_assistance':
      return 'bg-yellow-100 text-yellow-800'
    case 'paused':
      return 'bg-orange-100 text-orange-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Sessions</h3>
      <div class="flex items-center gap-2">
        <select
          v-model="statusFilter"
          @change="load"
          class="px-2 py-1.5 border border-[var(--goa-color-border)] rounded text-sm"
        >
          <option value="">All statuses</option>
          <option value="idle">Idle</option>
          <option value="running">Running</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="error">Error</option>
          <option value="needs_assistance">Needs assistance</option>
        </select>
        <button
          @click="load"
          class="px-3 py-1.5 text-sm font-medium bg-[var(--goa-color-primary)] text-white rounded hover:bg-[var(--goa-color-primary-dark)]"
        >
          Refresh
        </button>
      </div>
    </header>

    <div v-if="error" class="p-3 bg-red-50 border border-[var(--goa-color-error)] text-[var(--goa-color-error)] text-sm rounded">
      {{ error }}
    </div>

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
              <span :class="['px-2 py-0.5 rounded text-xs font-medium', statusClass(s.status)]">{{ s.status }}</span>
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
