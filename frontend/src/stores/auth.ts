/**
 * Pinia auth store — single source of truth for the current user.
 *
 * `loadUser()` hits `/api/me` and caches the result (idempotent). The router
 * `beforeEach` guard calls this so admin-only routes can check `isAdmin`.
 *
 * Stream A handoff: replace the `loadUser` body with an MSAL-issued token
 * flow. The exported shape (`user`, `isAdmin`, `loadUser`, `logout`) must
 * stay stable — AppHeader, AdminView, and the router guard all rely on it.
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "@/lib/api";
import type { AuthUser } from "@/types/admin";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAdmin = computed(() => user.value?.role === "admin");
  const isAuthenticated = computed(() => user.value !== null);

  async function loadUser(force = false): Promise<AuthUser | null> {
    if (user.value && !force) return user.value;
    if (loading.value) return user.value;

    loading.value = true;
    error.value = null;

    try {
      const result = await api.me();
      user.value = result.user;
      return user.value;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        user.value = null;
        return null;
      }
      error.value = (err as Error).message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  function logout(): void {
    user.value = null;
  }

  return {
    user,
    loading,
    error,
    isAdmin,
    isAuthenticated,
    loadUser,
    logout,
  };
});
