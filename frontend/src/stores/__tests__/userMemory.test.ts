/**
 * Unit tests for the userMemory Pinia store.
 *
 * fetch is stubbed via vi.stubGlobal for each test — no live backend needed.
 * Tests cover all CRUD operations for saved prompts, favorite workflows,
 * recent sessions, and preferences, plus the reset() action and 401 handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserMemoryStore } from '../userMemory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    }),
  )
}


const mockPrompt = {
  id: 'p-1',
  title: 'Test Prompt',
  prompt: 'Summarize this document.',
  tags: ['summary'],
  isPublic: false,
  ministryCode: 'INFRA',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — initial state', () => {
  it('starts with empty collections and no error', () => {
    const store = useUserMemoryStore()
    expect(store.savedPrompts).toEqual([])
    expect(store.favoriteWorkflows).toEqual([])
    expect(store.recentSessions).toEqual([])
    expect(store.preferences).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — reset()', () => {
  it('clears all state back to initial values', () => {
    const store = useUserMemoryStore()
    store.savedPrompts = [mockPrompt]
    store.error = 'some error'
    store.reset()
    expect(store.savedPrompts).toEqual([])
    expect(store.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchSavedPrompts
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — fetchSavedPrompts()', () => {
  it('populates savedPrompts on success', async () => {
    mockFetch(200, { prompts: [mockPrompt] })
    const store = useUserMemoryStore()
    await store.fetchSavedPrompts()
    expect(store.savedPrompts).toHaveLength(1)
    expect(store.savedPrompts[0].id).toBe('p-1')
    expect(store.loading).toBe(false)
  })

  it('sets error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network gone')))
    const store = useUserMemoryStore()
    await store.fetchSavedPrompts()
    expect(store.error).toMatch(/Network gone/)
    expect(store.savedPrompts).toEqual([])
  })

  it('resets auth store on 401', async () => {
    mockFetch(401, { error: 'Unauthorized' }, false)
    const store = useUserMemoryStore()
    await store.fetchSavedPrompts()
    expect(store.error).toMatch(/Session expired/)
  })
})

// ---------------------------------------------------------------------------
// savePrompt
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — savePrompt()', () => {
  it('prepends created prompt to savedPrompts', async () => {
    mockFetch(201, mockPrompt)
    const store = useUserMemoryStore()
    const result = await store.savePrompt({ title: 'Test Prompt', prompt: 'Summarize' })
    expect(result).not.toBeNull()
    expect(store.savedPrompts[0].id).toBe('p-1')
  })

  it('returns null and sets error on failure', async () => {
    mockFetch(500, { error: 'Server error' }, false)
    const store = useUserMemoryStore()
    const result = await store.savePrompt({ title: 'Test', prompt: 'Test' })
    expect(result).toBeNull()
    expect(store.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// deletePrompt
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — deletePrompt()', () => {
  it('removes the prompt from savedPrompts by id', async () => {
    const store = useUserMemoryStore()
    store.savedPrompts = [mockPrompt, { ...mockPrompt, id: 'p-2', title: 'Second' }]

    mockFetch(204, undefined)
    await store.deletePrompt('p-1')

    expect(store.savedPrompts).toHaveLength(1)
    expect(store.savedPrompts[0].id).toBe('p-2')
  })

  it('sets error and does not remove the prompt on failure', async () => {
    mockFetch(500, 'Server error', false)
    const store = useUserMemoryStore()
    store.savedPrompts = [mockPrompt]
    await store.deletePrompt('p-1')
    expect(store.error).toBeTruthy()
    // Prompt must still be in the store — no optimistic removal on error
    expect(store.savedPrompts).toHaveLength(1)
    expect(store.savedPrompts[0].id).toBe('p-1')
  })
})

// ---------------------------------------------------------------------------
// fetchFavoriteWorkflows
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — fetchFavoriteWorkflows()', () => {
  it('populates favoriteWorkflows on success', async () => {
    const mockFav = { workflowId: 'wf-1', favoritedAt: '2026-01-01', name: 'My WF', description: null }
    mockFetch(200, { favorites: [mockFav] })
    const store = useUserMemoryStore()
    await store.fetchFavoriteWorkflows()
    expect(store.favoriteWorkflows).toHaveLength(1)
    expect(store.favoriteWorkflows[0].workflowId).toBe('wf-1')
  })
})

// ---------------------------------------------------------------------------
// favoriteWorkflow / unfavoriteWorkflow
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — favoriteWorkflow()', () => {
  it('POSTs to the favorites endpoint and refreshes the list', async () => {
    const mockFav = { workflowId: 'wf-1', favoritedAt: '2026-01-01', name: 'WF', description: null }
    // First call: POST (204), second call: GET favorites
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', json: vi.fn().mockResolvedValue(undefined), text: vi.fn().mockResolvedValue('') })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: vi.fn().mockResolvedValue({ favorites: [mockFav] }), text: vi.fn().mockResolvedValue('') }),
    )
    const store = useUserMemoryStore()
    await store.favoriteWorkflow('wf-1')
    expect(store.favoriteWorkflows).toHaveLength(1)
  })
})

describe('useUserMemoryStore — unfavoriteWorkflow()', () => {
  it('removes the workflow from favoriteWorkflows optimistically', async () => {
    mockFetch(204, undefined)
    const store = useUserMemoryStore()
    store.favoriteWorkflows = [
      { workflowId: 'wf-1', favoritedAt: '2026-01-01', name: 'A', description: null },
      { workflowId: 'wf-2', favoritedAt: '2026-01-01', name: 'B', description: null },
    ]
    await store.unfavoriteWorkflow('wf-1')
    expect(store.favoriteWorkflows).toHaveLength(1)
    expect(store.favoriteWorkflows[0].workflowId).toBe('wf-2')
  })
})

// ---------------------------------------------------------------------------
// fetchRecentSessions
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — fetchRecentSessions()', () => {
  it('populates recentSessions on success', async () => {
    const mockSession = {
      id: 's-1',
      prompt: 'Hello',
      modelId: 'claude-opus-4-7',
      status: 'completed',
      classification: 'unclassified',
      createdAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:01:00Z',
    }
    mockFetch(200, { sessions: [mockSession] })
    const store = useUserMemoryStore()
    await store.fetchRecentSessions()
    expect(store.recentSessions).toHaveLength(1)
    expect(store.recentSessions[0].id).toBe('s-1')
  })
})

// ---------------------------------------------------------------------------
// fetchPreferences / updatePreferences
// ---------------------------------------------------------------------------

describe('useUserMemoryStore — fetchPreferences()', () => {
  it('sets preferences on success', async () => {
    const prefs = {
      defaultModelId: 'claude-sonnet-4-6',
      defaultClassification: 'unclassified',
      theme: 'dark',
      notificationPreferences: {},
    }
    mockFetch(200, prefs)
    const store = useUserMemoryStore()
    await store.fetchPreferences()
    expect(store.preferences?.defaultModelId).toBe('claude-sonnet-4-6')
    expect(store.preferences?.theme).toBe('dark')
  })
})

describe('useUserMemoryStore — updatePreferences()', () => {
  it('sends PUT then refreshes preferences', async () => {
    const updatedPrefs = {
      defaultModelId: 'claude-opus-4-7',
      defaultClassification: 'protected_a',
      theme: null,
      notificationPreferences: {},
    }
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', json: vi.fn().mockResolvedValue(undefined), text: vi.fn().mockResolvedValue('') })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: vi.fn().mockResolvedValue(updatedPrefs), text: vi.fn().mockResolvedValue('') }),
    )
    const store = useUserMemoryStore()
    await store.updatePreferences({ defaultModelId: 'claude-opus-4-7' })
    expect(store.preferences?.defaultModelId).toBe('claude-opus-4-7')
  })
})
