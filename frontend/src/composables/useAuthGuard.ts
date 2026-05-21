import type { NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Returns a Vue Router navigation guard that:
 * - Lazily hydrates the auth store on first navigation (single `/api/auth/me` call).
 * - Redirects unauthenticated visitors away from `meta.requiresAuth` (and
 *   `meta.requiresAdmin`) routes to `/login`, preserving the original target
 *   in `?returnTo=`.
 * - Sends already-authenticated users away from `/login` back to the app root.
 * - Redirects authenticated non-admin users away from `meta.requiresAdmin`
 *   routes to the app root. The backend `requireRole('admin')` middleware is
 *   the actual security boundary; this guard only suppresses the UI.
 */
export function useAuthGuard(): NavigationGuardWithThis<undefined> {
  return async (to: RouteLocationNormalized) => {
    const auth = useAuthStore()

    if (!auth.fetched && !auth.loading) {
      await auth.fetchMe()
    }

    const requiresAdmin = to.matched.some((record) => record.meta.requiresAdmin)
    const requiresAuth =
      requiresAdmin || to.matched.some((record) => record.meta.requiresAuth)

    if (requiresAuth && !auth.isAuthenticated) {
      return {
        name: 'login',
        query: { returnTo: to.fullPath !== '/login' ? to.fullPath : '/' },
      }
    }

    if (requiresAdmin && !auth.isAdmin) {
      return { name: 'free-agent' }
    }

    if (to.name === 'login' && auth.isAuthenticated) {
      return { name: 'free-agent' }
    }
  }
}
