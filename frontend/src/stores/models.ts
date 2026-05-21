/**
 * Caches /api/agent/models so every Free Agent task panel reuses the same list.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiFetch } from '@/composables/useApiFetch'

export interface ModelEntry {
  id: string
  name: string
  provider: string
  maxOutputTokens: number
  supportsStreaming: boolean
  supportsTools: boolean
  dataResidency: string
  maxClassification: string
}

export const useModelsStore = defineStore('models', () => {
  const models = ref<ModelEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let loaded = false

  async function ensureLoaded(): Promise<void> {
    if (loaded || loading.value) return
    loading.value = true
    error.value = null
    try {
      const data = await apiFetch<{ models: ModelEntry[] }>('/api/agent/models')
      models.value = data.models ?? []
      loaded = true
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  return { models, loading, error, ensureLoaded }
})
