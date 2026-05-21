<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { PIIDetection } from '@/types/admin'

const detections = ref<PIIDetection[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await api.admin.piiDetections({ limit: 200 })
    detections.value = result.detections
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function actionBadgeClass(action: string): string {
  switch (action) {
    case 'blocked':
      return 'bg-red-100 text-[var(--goa-color-error)]'
    case 'redacted':
      return 'bg-yellow-100 text-yellow-800'
    case 'flagged':
      return 'bg-blue-100 text-[var(--goa-color-primary-dark)]'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">PII Detections</h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Matches are truncated server-side (first 4 chars + ***). Raw values are never persisted.
        </p>
      </div>
      <button
        @click="load"
        class="px-3 py-1.5 text-sm font-medium bg-[var(--goa-color-primary)] text-white rounded hover:bg-[var(--goa-color-primary-dark)]"
      >
        Refresh
      </button>
    </header>

    <div v-if="error" class="p-3 bg-red-50 border border-[var(--goa-color-error)] text-[var(--goa-color-error)] text-sm rounded">
      {{ error }}
    </div>

    <div class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]">
          <tr>
            <th class="text-left px-3 py-2 font-semibold">Time</th>
            <th class="text-left px-3 py-2 font-semibold">Type</th>
            <th class="text-left px-3 py-2 font-semibold">Action</th>
            <th class="text-left px-3 py-2 font-semibold">Match</th>
            <th class="text-left px-3 py-2 font-semibold">User</th>
            <th class="text-left px-3 py-2 font-semibold">Session</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">Loading…</td>
          </tr>
          <tr v-else-if="detections.length === 0">
            <td colspan="6" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">No PII detections recorded.</td>
          </tr>
          <tr v-for="d in detections" :key="d.id" class="border-t border-[var(--goa-color-border)] hover:bg-gray-50">
            <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">{{ new Date(d.created_at).toLocaleString() }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ d.detection_type }}</td>
            <td class="px-3 py-2">
              <span :class="['px-2 py-0.5 rounded text-xs font-medium', actionBadgeClass(d.action_taken)]">
                {{ d.action_taken }}
              </span>
            </td>
            <td class="px-3 py-2 font-mono text-xs">{{ d.context_snippet ?? '—' }}</td>
            <td class="px-3 py-2 text-xs">{{ d.user_display_name || d.user_email || d.user_id || '—' }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ d.session_id ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
