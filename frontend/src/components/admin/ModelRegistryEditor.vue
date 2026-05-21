<script setup lang="ts">
import { ref, onActivated } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { ModelRegistryEntry } from '@/types/admin'

const models = ref<ModelRegistryEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const updatingId = ref<number | null>(null)

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
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    updatingId.value = null
  }
}

function classificationBadge(c: string): string {
  switch (c) {
    case 'protected_b':
      return 'bg-red-100 text-[var(--goa-color-error)]'
    case 'protected_a':
      return 'bg-yellow-100 text-yellow-800'
    default:
      return 'bg-green-100 text-[var(--goa-color-success)]'
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
        <h3 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Model Registry</h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Toggle approved LLMs. Inactive models cannot be selected in new sessions.
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
            <th class="text-left px-3 py-2 font-semibold">Model</th>
            <th class="text-left px-3 py-2 font-semibold">Provider</th>
            <th class="text-left px-3 py-2 font-semibold">Residency</th>
            <th class="text-left px-3 py-2 font-semibold">Max Classification</th>
            <th class="text-left px-3 py-2 font-semibold">Active</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">Loading…</td>
          </tr>
          <tr v-else-if="models.length === 0">
            <td colspan="5" class="px-3 py-6 text-center text-[var(--goa-color-text-secondary)]">No models registered. Seed `model_registry` to begin.</td>
          </tr>
          <tr v-for="m in models" :key="m.id" class="border-t border-[var(--goa-color-border)] hover:bg-gray-50">
            <td class="px-3 py-2">
              <div class="font-medium">{{ m.display_name }}</div>
              <div class="font-mono text-xs text-[var(--goa-color-text-secondary)]">{{ m.model_id }}</div>
            </td>
            <td class="px-3 py-2 font-mono text-xs">{{ m.provider }}</td>
            <td class="px-3 py-2 text-xs uppercase">{{ m.data_residency }}</td>
            <td class="px-3 py-2">
              <span :class="['px-2 py-0.5 rounded text-xs font-medium', classificationBadge(m.max_classification)]">
                {{ m.max_classification }}
              </span>
            </td>
            <td class="px-3 py-2">
              <button
                @click="toggle(m)"
                :disabled="updatingId === m.id"
                :class="[
                  'px-3 py-1 rounded text-xs font-medium',
                  m.is_active
                    ? 'bg-[var(--goa-color-success)] text-white'
                    : 'bg-gray-300 text-gray-700',
                  updatingId === m.id ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80',
                ]"
              >
                {{ updatingId === m.id ? '…' : m.is_active ? 'Active' : 'Inactive' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
