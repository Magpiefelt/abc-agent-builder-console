import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { AuthUser } from '@/types/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const fetched = ref(false)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const initials = computed(() => {
    if (!user.value?.displayName) return ''
    return user.value.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
  })

  let inFlightFetch: Promise<void> | null = null

  async function fetchMe(): Promise<void> {
    // Dedupe concurrent calls (e.g., router guard + App.vue both kicking off).
    if (inFlightFetch) return inFlightFetch
    inFlightFetch = (async () => {
      loading.value = true
      error.value = null
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (response.ok) {
          user.value = (await response.json()) as AuthUser
        } else if (response.status === 401) {
          user.value = null
        } else {
          error.value = `Failed to load user (${response.status})`
        }
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Network error'
      } finally {
        loading.value = false
        fetched.value = true
        inFlightFetch = null
      }
    })()
    return inFlightFetch
  }

  function login(returnTo: string = window.location.pathname + window.location.search): void {
    const url = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    window.location.href = url
  }

  async function logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore network errors — the cookie is httpOnly so we can't clear it from JS regardless.
    }
    user.value = null
    fetched.value = false
  }

  function reset(): void {
    user.value = null
    error.value = null
    fetched.value = false
  }

  return {
    user,
    loading,
    error,
    fetched,
    isAuthenticated,
    isAdmin,
    initials,
    fetchMe,
    login,
    logout,
    reset,
  }
})
