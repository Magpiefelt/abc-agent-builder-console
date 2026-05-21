/**
 * Pinia auth store — single source of truth for the current user.
 *
 * `loadUser()` hits `/api/me` and caches the result (idempotent). Parallel
 * calls share the in-flight request to avoid double-fetching on simultaneous
 * navigations (e.g. `beforeEach` racing with the AppHeader's initial render).
 *
 * Stream A handoff: replace the `loadUser` body with an MSAL-issued token
 * flow. The exported shape (`user`, `isAdmin`, `loadUser`, `logout`) must
 * stay stable — AppHeader, AdminView, and the router guard all rely on it.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import type { AuthUser } from '@/types/admin'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let inFlight: Promise<AuthUser | null> | null = null

  const isAdmin = computed(() => user.value?.role === 'admin')
  const isAuthenticated = computed(() => user.value !== null)

  async function loadUser(force = false): Promise<AuthUser | null> {
    if (user.value && !force) return user.value
    if (inFlight) return inFlight

    loading.value = true
    error.value = null

    inFlight = (async () => {
      try {
        const result = await api.me()
        user.value = result.user
        return user.value
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          user.value = null
          return null
        }
        error.value = (err as Error).message
        return null
      } finally {
        loading.value = false
        inFlight = null
      }
    })()

    return inFlight
  }

  function logout(): void {
    user.value = null
  }

  return {
    user,
    loading,
    error,
    isAdmin,
    isAuthenticated,
    loadUser,
    logout,
  }
})
