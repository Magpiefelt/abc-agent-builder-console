<script setup lang="ts">
import { computed, ref, onActivated } from 'vue'
import { api, ApiError } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import type { ModelRegistryEntry } from '@/types/admin'

const models = ref<ModelRegistryEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const updatingId = ref<number | null>(null)
const toast = useToast()

const activeCount = computed(() => models.value.filter((m) => m.is_active).length)

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await api.admin.models()
    models.value = result.models
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function toggle(model: ModelRegistryEntry) {
  updatingId.value = model.id
  try {
    const result = await api.admin.updateModel(model.id, { is_active: !model.is_active })
    const idx = models.value.findIndex((m) => m.id === model.id)
    const existing = models.value[idx]
    if (idx !== -1 && existing) {
      models.value[idx] = { ...existing, is_active: result.model.is_active }
    }
    toast.push({
      kind: 'success',
      message: `${model.display_name} ${result.model.is_active ? 'activated' : 'deactivated'}.`,
    })
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    error.value = message
    toast.push({ kind: 'error', message: `Couldn't update ${model.display_name}: ${message}` })
  } finally {
    updatingId.value = null
  }
}

function classificationBadgeType(c: string): 'emergency' | 'important' | 'success' {
  switch (c) {
    case 'protected_b':
      return 'emergency'
    case 'protected_a':
      return 'important'
    default:
      return 'success'
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
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-text-default)]">Model Registry</h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Toggle approved LLMs. Inactive models cannot be selected in new sessions.
        </p>
        <p
          v-if="!loading && models.length > 0"
          class="text-xs text-[var(--goa-color-text-secondary)] mt-1"
          aria-live="polite"
        >
          {{ activeCount }} of {{ models.length }} active
        </p>
      </div>
      <goa-button type="primary" size="compact" leadingicon="refresh" @_click="load">
        Refresh
      </goa-button>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't update model registry">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Model</th>
          <th>Provider</th>
          <th>Residency</th>
          <th>Max Classification</th>
          <th>Active</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="5" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="models.length === 0">
          <td colspan="5" class="text-center">No models registered. Seed `model_registry` to begin.</td>
        </tr>
        <tr v-for="m in models" :key="m.id">
          <td>
            <div class="font-medium">{{ m.display_name }}</div>
            <div class="font-mono text-xs text-[var(--goa-color-text-secondary)]">{{ m.model_id }}</div>
          </td>
          <td class="font-mono text-xs">{{ m.provider }}</td>
          <td class="text-xs uppercase">{{ m.data_residency }}</td>
          <td>
            <goa-badge
              :type="classificationBadgeType(m.max_classification)"
              :content="m.max_classification"
            ></goa-badge>
          </td>
          <td>
            <goa-button
              :type="m.is_active ? 'primary' : 'secondary'"
              size="compact"
              :disabled="updatingId === m.id || undefined"
              @_click="toggle(m)"
            >
              {{ updatingId === m.id ? '…' : m.is_active ? 'Active' : 'Inactive' }}
            </goa-button>
          </td>
        </tr>
      </tbody>
    </goa-table>
  </div>
</template>
