/**
 * Unit tests for the useAuthGuard navigation guard.
 *
 * We drive the guard directly (it's a plain async function) with mock route
 * objects, and stub out the auth store's fetchMe so no network call is made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { useAuthGuard } from '../useAuthGuard'
import { useAuthStore } from '@/stores/auth'
import type { AuthUser } from '@/types/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adminUser: AuthUser = {
  id: 'u-1',
  entraId: 'e-1',
  email: 'admin@gov.ab.ca',
  displayName: 'Admin User',
  ministryCode: 'INFRA',
  role: 'admin',
}

const regularUser: AuthUser = {
  id: 'u-2',
  entraId: 'e-2',
  email: 'user@gov.ab.ca',
  displayName: 'Regular User',
  ministryCode: 'INFRA',
  role: 'user',
}

type RouteRecord = { meta?: { requiresAuth?: boolean; requiresAdmin?: boolean } }

function makeRoute(
  name = 'home',
  meta: { requiresAuth?: boolean; requiresAdmin?: boolean } = {},
  matchedMetas: RouteRecord[] = [],
) {
  return {
    name,
    fullPath: `/${name}`,
    matched: matchedMetas.length > 0 ? matchedMetas : [{ meta }],
    meta,
    params: {},
    query: {},
    hash: '',
    path: `/${name}`,
  } as never
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuthGuard — unauthenticated visitor on public route', () => {
  it('returns undefined (allow) for public routes when not authenticated', async () => {
    const auth = useAuthStore()
    auth.user = null
    auth.fetched = true // skip fetchMe

    const guard = useAuthGuard()
    const result = await guard(makeRoute('home', {}), {} as never)
    expect(result).toBeUndefined()
  })
})

describe('useAuthGuard — unauthenticated visitor on requiresAuth route', () => {
  it('redirects to login with returnTo preserved', async () => {
    const auth = useAuthStore()
    auth.user = null
    auth.fetched = true

    const guard = useAuthGuard()
    const result = await guard(makeRoute('dashboard', { requiresAuth: true }), {} as never)

    expect(result).toMatchObject({
      name: 'login',
      query: { returnTo: '/dashboard' },
    })
  })
})

describe('useAuthGuard — unauthenticated visitor on requiresAdmin route', () => {
  it('redirects to login for admin routes when not authenticated', async () => {
    const auth = useAuthStore()
    auth.user = null
    auth.fetched = true

    const guard = useAuthGuard()
    const result = await guard(makeRoute('admin', { requiresAdmin: true }), {} as never)

    expect(result).toMatchObject({ name: 'login' })
  })
})

describe('useAuthGuard — authenticated non-admin on requiresAdmin route', () => {
  it('redirects to free-agent when user lacks admin role', async () => {
    const auth = useAuthStore()
    auth.user = regularUser
    auth.fetched = true

    const guard = useAuthGuard()
    const result = await guard(makeRoute('admin', { requiresAdmin: true }), {} as never)

    expect(result).toMatchObject({ name: 'free-agent' })
  })
})

describe('useAuthGuard — authenticated admin on requiresAdmin route', () => {
  it('returns undefined (allow) for admin users', async () => {
    const auth = useAuthStore()
    auth.user = adminUser
    auth.fetched = true

    const guard = useAuthGuard()
    const result = await guard(makeRoute('admin', { requiresAdmin: true }), {} as never)
    expect(result).toBeUndefined()
  })
})

describe('useAuthGuard — authenticated user visits /login', () => {
  it('redirects to free-agent when already signed in', async () => {
    const auth = useAuthStore()
    auth.user = regularUser
    auth.fetched = true

    const guard = useAuthGuard()
    const result = await guard(makeRoute('login', {}), {} as never)

    expect(result).toMatchObject({ name: 'free-agent' })
  })
})

describe('useAuthGuard — lazy fetchMe on first navigation', () => {
  it('calls fetchMe once when auth is not yet fetched', async () => {
    const auth = useAuthStore()
    auth.user = null
    auth.fetched = false

    const fetchMeSpy = vi.spyOn(auth, 'fetchMe').mockResolvedValue(undefined)

    const guard = useAuthGuard()
    await guard(makeRoute('home', {}), {} as never)

    expect(fetchMeSpy).toHaveBeenCalledOnce()
  })

  it('does not call fetchMe when already fetched', async () => {
    const auth = useAuthStore()
    auth.user = adminUser
    auth.fetched = true

    const fetchMeSpy = vi.spyOn(auth, 'fetchMe').mockResolvedValue(undefined)

    const guard = useAuthGuard()
    await guard(makeRoute('home', {}), {} as never)

    expect(fetchMeSpy).not.toHaveBeenCalled()
  })
})

describe('useAuthGuard — returnTo edge cases', () => {
  it('does not add returnTo=/login to the query (avoids loop)', async () => {
    const auth = useAuthStore()
    auth.user = null
    auth.fetched = true

    const guard = useAuthGuard()
    const loginRoute = makeRoute('login', { requiresAuth: false })
    // Simulate visiting /login while unauthenticated — no loop
    const result = await guard(loginRoute, {} as never)
    // The route is public, so should be allowed or redirect without returnTo=/login
    if (result && typeof result === 'object' && 'query' in result) {
      expect((result as { query?: { returnTo?: string } }).query?.returnTo).not.toBe('/login')
    }
  })
})
