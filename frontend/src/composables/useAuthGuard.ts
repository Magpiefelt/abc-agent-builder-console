import type { NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Returns a Vue Router navigation guard that:
 * - Lazily hydrates the auth store on first navigation (single `/api/auth/me` call).
 * - Redirects unauthenticated visitors away from `meta.requiresAuth` routes to `/login`,
 *   preserving the original target in `?returnTo=`.
 * - Sends already-authenticated users away from `/login` back to the app root.
 */
export function useAuthGuard(): NavigationGuardWithThis<undefined> {
  return async (to: RouteLocationNormalized) => {
    const auth = useAuthStore()

    if (!auth.fetched && !auth.loading) {
      await auth.fetchMe()
    }

    const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)

    if (requiresAuth && !auth.isAuthenticated) {
      return {
        name: 'login',
        query: { returnTo: to.fullPath !== '/login' ? to.fullPath : '/' },
      }
    }

    if (to.name === 'login' && auth.isAuthenticated) {
      return { name: 'free-agent' }
    }
  }
}
