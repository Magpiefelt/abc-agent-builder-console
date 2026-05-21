<script setup lang="ts">
import { ref, onActivated } from 'vue'
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

function actionBadgeType(action: string): 'emergency' | 'important' | 'information' | 'midtone' {
  switch (action) {
    case 'blocked':
      return 'emergency'
    case 'redacted':
      return 'important'
    case 'flagged':
      return 'information'
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
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">PII Detections</h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Matches are truncated server-side (first 4 chars + ***). Raw values are never persisted.
        </p>
      </div>
      <goa-button type="primary" size="compact" leadingicon="refresh" @_click="load">
        Refresh
      </goa-button>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load PII detections">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Action</th>
          <th>Match</th>
          <th>User</th>
          <th>Session</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="6" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="detections.length === 0">
          <td colspan="6" class="text-center">No PII detections recorded.</td>
        </tr>
        <tr v-for="d in detections" :key="d.id">
          <td class="whitespace-nowrap font-mono text-xs">{{ new Date(d.created_at).toLocaleString() }}</td>
          <td class="font-mono text-xs">{{ d.detection_type }}</td>
          <td>
            <goa-badge :type="actionBadgeType(d.action_taken)" :content="d.action_taken"></goa-badge>
          </td>
          <td class="font-mono text-xs">{{ d.context_snippet ?? '—' }}</td>
          <td class="text-xs">{{ d.user_display_name || d.user_email || d.user_id || '—' }}</td>
          <td class="font-mono text-xs">{{ d.session_id ?? '—' }}</td>
        </tr>
      </tbody>
    </goa-table>
  </div>
</template>
