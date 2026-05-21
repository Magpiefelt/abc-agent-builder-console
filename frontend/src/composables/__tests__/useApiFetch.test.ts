/**
 * Unit tests for the apiFetch composable.
 *
 * fetch is stubbed via vi.stubGlobal. The auth store reset on 401 is exercised
 * by using a real Pinia instance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---------------------------------------------------------------------------
// Setup — real Pinia so useAuthStore.reset() actually works
// ---------------------------------------------------------------------------

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Import under test (after Pinia setup so auth store mounts correctly)
// ---------------------------------------------------------------------------

import { apiFetch } from '../useApiFetch'
import { useAuthStore } from '@/stores/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(text),
    }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('apiFetch — 200 success', () => {
  it('returns the parsed JSON body', async () => {
    mockFetch(200, { data: 42 })
    const result = await apiFetch<{ data: number }>('/api/test')
    expect(result).toEqual({ data: 42 })
  })

  it('always includes credentials: include', async () => {
    mockFetch(200, {})
    await apiFetch('/api/test')
    const call = vi.mocked(global.fetch).mock.calls[0]
    expect((call[1] as RequestInit).credentials).toBe('include')
  })

  it('includes Accept: application/json header', async () => {
    mockFetch(200, {})
    await apiFetch('/api/test')
    const call = vi.mocked(global.fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['Accept']).toBe('application/json')
  })

  it('passes extra headers from init to fetch', async () => {
    // Note: the implementation spreads `...init` last so init.headers takes
    // precedence over the defaults. Callers should include Accept if needed.
    mockFetch(200, {})
    await apiFetch('/api/test', { headers: { 'X-Custom': 'yes', Accept: 'application/json' } })
    const call = vi.mocked(global.fetch).mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Custom']).toBe('yes')
  })
})

describe('apiFetch — 204 no content', () => {
  it('returns undefined for 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: vi.fn().mockResolvedValue(undefined),
        text: vi.fn().mockResolvedValue(''),
      }),
    )
    const result = await apiFetch('/api/test')
    expect(result).toBeUndefined()
  })
})

describe('apiFetch — 401 resets auth store', () => {
  it('throws ApiError with status 401 and resets auth.user', async () => {
    const auth = useAuthStore()
    // Pre-populate user to verify reset happens
    auth.user = { id: 'u-1', email: 'x@y.com', displayName: 'X', role: 'user', entraId: 'e1', ministryCode: 'T' }

    mockFetch(401, { error: 'Unauthorized' }, false)

    await expect(apiFetch('/api/test')).rejects.toThrow(/Session expired/)
    expect(auth.user).toBeNull() // store was reset
  })
})

describe('apiFetch — 4xx / 5xx errors', () => {
  it('throws ApiError with status and server error message for 400', async () => {
    mockFetch(400, { error: 'Bad request — missing field' }, false)

    try {
      await apiFetch('/api/test')
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as { status: number; message: string }
      expect(e.status).toBe(400)
      expect(e.message).toMatch(/Bad request/)
    }
  })

  it('throws with statusText fallback when body has no error field', async () => {
    mockFetch(503, 'Service Unavailable', false)

    try {
      await apiFetch('/api/test')
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as { status: number; message: string }
      expect(e.status).toBe(503)
      expect(e.message).toBeTruthy()
    }
  })

  it('attaches the detail field to the thrown error', async () => {
    const detail = { code: 'VALIDATION_ERROR', fields: ['email'] }
    mockFetch(422, detail, false)

    try {
      await apiFetch('/api/test')
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as { detail: unknown }
      expect(e.detail).toEqual(detail)
    }
  })
})
