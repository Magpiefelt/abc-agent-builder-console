import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from '@/stores/auth'

export interface SavedPrompt {
  id: string
  title: string
  prompt: string
  tags: string[]
  isPublic: boolean
  ministryCode: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowFavorite {
  workflowId: string
  favoritedAt: string
  name: string | null
  description: string | null
}

export interface RecentSession {
  id: string
  prompt: string
  modelId: string
  status: string
  classification: string
  createdAt: string
  completedAt: string | null
  starred: boolean
}

export interface UserPreferences {
  defaultModelId: string | null
  defaultClassification: string | null
  theme: string | null
  notificationPreferences: Record<string, unknown>
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (response.status === 401) {
    // Session expired or invalid — clear local auth state so the router guard
    // will bounce the user to /login on the next navigation.
    useAuthStore().reset()
    throw new Error('Session expired. Please sign in again.')
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  if (response.status === 204) return undefined as unknown as T
  return (await response.json()) as T
}

export const useUserMemoryStore = defineStore('userMemory', () => {
  const savedPrompts = ref<SavedPrompt[]>([])
  const favoriteWorkflows = ref<WorkflowFavorite[]>([])
  const recentSessions = ref<RecentSession[]>([])
  const preferences = ref<UserPreferences | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function setError(err: unknown): void {
    error.value = err instanceof Error ? err.message : 'Request failed'
  }

  // ----- Saved prompts -----

  async function fetchSavedPrompts(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await jsonFetch<{ prompts: SavedPrompt[] }>('/api/users/me/saved-prompts')
      savedPrompts.value = data.prompts
    } catch (err) {
      setError(err)
    } finally {
      loading.value = false
    }
  }

  async function savePrompt(input: {
    title: string
    prompt: string
    tags?: string[]
    isPublic?: boolean
  }): Promise<SavedPrompt | null> {
    error.value = null
    try {
      const created = await jsonFetch<SavedPrompt>('/api/users/me/saved-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      savedPrompts.value = [created, ...savedPrompts.value]
      return created
    } catch (err) {
      setError(err)
      return null
    }
  }

  async function deletePrompt(id: string): Promise<void> {
    try {
      await jsonFetch<void>(`/api/users/me/saved-prompts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      savedPrompts.value = savedPrompts.value.filter((p) => p.id !== id)
    } catch (err) {
      setError(err)
    }
  }

  // ----- Favorite workflows -----

  async function fetchFavoriteWorkflows(): Promise<void> {
    try {
      const data = await jsonFetch<{ favorites: WorkflowFavorite[] }>(
        '/api/users/me/favorite-workflows',
      )
      favoriteWorkflows.value = data.favorites
    } catch (err) {
      setError(err)
    }
  }

  async function favoriteWorkflow(workflowId: string): Promise<void> {
    try {
      await jsonFetch<void>(`/api/users/me/favorite-workflows/${encodeURIComponent(workflowId)}`, {
        method: 'POST',
      })
      await fetchFavoriteWorkflows()
    } catch (err) {
      setError(err)
    }
  }

  async function unfavoriteWorkflow(workflowId: string): Promise<void> {
    try {
      await jsonFetch<void>(`/api/users/me/favorite-workflows/${encodeURIComponent(workflowId)}`, {
        method: 'DELETE',
      })
      favoriteWorkflows.value = favoriteWorkflows.value.filter((f) => f.workflowId !== workflowId)
    } catch (err) {
      setError(err)
    }
  }

  // ----- Recent sessions -----

  // Filter chip state (Bot 19, F8). The store owns it so the
  // SessionHistoryView can toggle and re-fetch without juggling a separate
  // ref. Defaults to `false` so existing callers see no behaviour change.
  const recentStarredOnly = ref(false)

  async function fetchRecentSessions(options?: { starredOnly?: boolean }): Promise<void> {
    if (options?.starredOnly !== undefined) {
      recentStarredOnly.value = options.starredOnly
    }
    const qs = recentStarredOnly.value ? '?starred=true' : ''
    try {
      const data = await jsonFetch<{ sessions: RecentSession[] }>(
        `/api/users/me/recent-sessions${qs}`,
      )
      // Default starred to false for older API responses that don't carry the
      // field yet (e.g. mid-deploy ordering).
      recentSessions.value = data.sessions.map((s) => ({ ...s, starred: s.starred ?? false }))
    } catch (err) {
      setError(err)
    }
  }

  /**
   * Toggle the star flag on a recent session (Bot 19, F8). Optimistic: flip
   * locally first so the UI feels instant, then PATCH and roll back on
   * failure. The recent-sessions list is re-fetched only when the active
   * "Starred only" filter would have changed visibility.
   */
  async function toggleSessionStar(id: string, nextStarred: boolean): Promise<void> {
    const row = recentSessions.value.find((s) => s.id === id)
    const previous = row?.starred ?? false
    if (row) {
      row.starred = nextStarred
      recentSessions.value = [...recentSessions.value]
    }
    try {
      await jsonFetch<{ id: string; starred: boolean }>(
        `/api/agent/sessions/${encodeURIComponent(id)}/star`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starred: nextStarred }),
        },
      )
      // If the user is currently filtering to starred-only and they just
      // unstarred a row, drop it from the visible list so it doesn't linger.
      if (recentStarredOnly.value && !nextStarred) {
        recentSessions.value = recentSessions.value.filter((s) => s.id !== id)
      }
    } catch (err) {
      if (row) {
        row.starred = previous
        recentSessions.value = [...recentSessions.value]
      }
      setError(err)
    }
  }

  // ----- Preferences -----

  async function fetchPreferences(): Promise<void> {
    try {
      preferences.value = await jsonFetch<UserPreferences>('/api/users/me/preferences')
    } catch (err) {
      setError(err)
    }
  }

  async function updatePreferences(input: Partial<UserPreferences>): Promise<void> {
    try {
      await jsonFetch<void>('/api/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      await fetchPreferences()
    } catch (err) {
      setError(err)
    }
  }

  function reset(): void {
    savedPrompts.value = []
    favoriteWorkflows.value = []
    recentSessions.value = []
    preferences.value = null
    error.value = null
    recentStarredOnly.value = false
  }

  return {
    savedPrompts,
    favoriteWorkflows,
    recentSessions,
    recentStarredOnly,
    preferences,
    loading,
    error,
    fetchSavedPrompts,
    savePrompt,
    deletePrompt,
    fetchFavoriteWorkflows,
    favoriteWorkflow,
    unfavoriteWorkflow,
    fetchRecentSessions,
    toggleSessionStar,
    fetchPreferences,
    updatePreferences,
    reset,
  }
})
