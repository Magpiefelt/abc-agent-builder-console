/**
 * Unit tests for the auth Pinia store.
 *
 * Network calls to /api/auth/* are stubbed via vi.stubGlobal('fetch', …)
 * so these tests run without a live backend.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'
import type { AuthUser } from '@/types/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser: AuthUser = {
  id: 'u-001',
  entraId: 'entra-001',
  email: 'cohen.mcleod@gov.ab.ca',
  displayName: 'Cohen McLeod',
  ministryCode: 'INFRA',
  role: 'admin',
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: vi.fn().mockResolvedValue(body),
    }),
  )
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuthStore — initial state', () => {
  it('starts with null user, not loading, not fetched', () => {
    const auth = useAuthStore()
    expect(auth.user).toBeNull()
    expect(auth.loading).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.isAdmin).toBe(false)
    expect(auth.fetched).toBe(false)
  })
})

describe('useAuthStore — fetchMe()', () => {
  it('sets user when /api/auth/me returns 200', async () => {
    mockFetch(200, mockUser)
    const auth = useAuthStore()
    await auth.fetchMe()
    expect(auth.user).toEqual(mockUser)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.fetched).toBe(true)
    expect(auth.loading).toBe(false)
  })

  it('sets user to null when /api/auth/me returns 401', async () => {
    mockFetch(401, { error: 'Unauthorized' })
    const auth = useAuthStore()
    await auth.fetchMe()
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('sets error when /api/auth/me returns an unexpected status', async () => {
    mockFetch(500, {})
    const auth = useAuthStore()
    await auth.fetchMe()
    expect(auth.error).toMatch(/500/)
    expect(auth.user).toBeNull()
  })

  it('sets error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))
    const auth = useAuthStore()
    await auth.fetchMe()
    expect(auth.error).toMatch(/Network down/)
  })

  it('deduplicates concurrent calls (issues only one network request)', async () => {
    mockFetch(200, mockUser)
    const auth = useAuthStore()
    // Fire two fetches concurrently — the store's inFlightFetch guard should
    // prevent a second network call. Both promises must resolve successfully.
    const [, ] = await Promise.all([auth.fetchMe(), auth.fetchMe()])
    const fetchMock = vi.mocked(global.fetch)
    // The deduplication guard means fetch is only called once despite two callers.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth.user).toEqual(mockUser)
  })
})

describe('useAuthStore — computed getters', () => {
  it('isAdmin is true when user.role === admin', () => {
    const auth = useAuthStore()
    auth.user = { ...mockUser, role: 'admin' }
    expect(auth.isAdmin).toBe(true)
  })

  it('isAdmin is false for user role', () => {
    const auth = useAuthStore()
    auth.user = { ...mockUser, role: 'user' }
    expect(auth.isAdmin).toBe(false)
  })

  it('initials derive from displayName', () => {
    const auth = useAuthStore()
    auth.user = { ...mockUser, displayName: 'Cohen McLeod' }
    expect(auth.initials).toBe('CM')
  })

  it('initials handles single-word names', () => {
    const auth = useAuthStore()
    auth.user = { ...mockUser, displayName: 'Cohen' }
    expect(auth.initials).toBe('C')
  })

  it('initials returns empty string when displayName is empty', () => {
    const auth = useAuthStore()
    auth.user = { ...mockUser, displayName: '' }
    expect(auth.initials).toBe('')
  })
})

describe('useAuthStore — logout()', () => {
  it('clears user and fetched flag after logout', async () => {
    mockFetch(204, {})
    const auth = useAuthStore()
    auth.user = mockUser
    await auth.logout()
    expect(auth.user).toBeNull()
    expect(auth.fetched).toBe(false)
  })

  it('clears user even if the logout network call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network gone')))
    const auth = useAuthStore()
    auth.user = mockUser
    await auth.logout()
    expect(auth.user).toBeNull()
  })
})

describe('useAuthStore — reset()', () => {
  it('resets all state back to initial values', () => {
    const auth = useAuthStore()
    auth.user = mockUser
    auth.error = 'some error'
    auth.fetched = true
    auth.reset()
    expect(auth.user).toBeNull()
    expect(auth.error).toBeNull()
    expect(auth.fetched).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })
})
