/**
 * Unit tests for the models Pinia store.
 *
 * `apiFetch` is mocked so no live backend is needed. Tests cover:
 *  - ensureLoaded fetches models on first call
 *  - deduplication: concurrent or repeated calls don't double-fetch
 *  - error handling: sets error state when apiFetch throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---------------------------------------------------------------------------
// Mock useApiFetch (apiFetch is imported by the store)
// ---------------------------------------------------------------------------

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useApiFetch', () => ({ apiFetch: apiFetchMock }))

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { useModelsStore } from '../models'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockModels = [
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    provider: 'anthropic',
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsTools: true,
    dataResidency: 'canada',
    maxClassification: 'protected_b',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsTools: true,
    dataResidency: 'canada',
    maxClassification: 'protected_a',
  },
]

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetchMock.mockReset()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useModelsStore — initial state', () => {
  it('starts with empty models, not loading, no error', () => {
    const store = useModelsStore()
    expect(store.models).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })
})

describe('useModelsStore — ensureLoaded()', () => {
  it('fetches models and populates the store on first call', async () => {
    apiFetchMock.mockResolvedValueOnce({ models: mockModels })

    const store = useModelsStore()
    await store.ensureLoaded()

    expect(store.models).toHaveLength(2)
    expect(store.models[0].id).toBe('claude-opus-4-7')
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('calls apiFetch with /api/agent/models', async () => {
    apiFetchMock.mockResolvedValueOnce({ models: [] })

    const store = useModelsStore()
    await store.ensureLoaded()

    expect(apiFetchMock).toHaveBeenCalledWith('/api/agent/models')
  })

  it('does not fetch again if already loaded', async () => {
    apiFetchMock.mockResolvedValue({ models: mockModels })

    const store = useModelsStore()
    await store.ensureLoaded()
    await store.ensureLoaded() // second call

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent calls (only one network request)', async () => {
    apiFetchMock.mockResolvedValue({ models: mockModels })

    const store = useModelsStore()
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('sets error when apiFetch throws', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('Network error'))

    const store = useModelsStore()
    await store.ensureLoaded()

    expect(store.error).toMatch(/Network error/)
    expect(store.models).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('handles a response with an empty models array gracefully', async () => {
    apiFetchMock.mockResolvedValueOnce({ models: [] })

    const store = useModelsStore()
    await store.ensureLoaded()

    expect(store.models).toEqual([])
    expect(store.error).toBeNull()
  })

  it('handles a response where models is undefined (uses empty array)', async () => {
    apiFetchMock.mockResolvedValueOnce({}) // no `models` key

    const store = useModelsStore()
    await store.ensureLoaded()

    expect(store.models).toEqual([])
  })
})
