/**
 * Tests for SessionHistoryView.
 *
 * The view renders the user's recent Free Agent sessions in a list with two
 * actions per row: Open (router navigation to /sessions/:id) and Download
 * (calls `agentSession.exportTranscript(id)` which is mocked here so the
 * test never touches the real export pipeline).
 *
 * We mock `fetch` for the `/api/users/me/recent-sessions` call the
 * userMemory store makes on mount. The exportTranscript path is mocked via
 * vi.spyOn on the live Pinia store after mount so we exercise the view's
 * wiring, not the store internals (the store has its own dedicated tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SessionHistoryView from '../SessionHistoryView.vue'
import { useUserMemoryStore } from '@/stores/userMemory'
import { useAgentSessionStore } from '@/stores/agentSession'

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

let fetchCalls: FetchCall[]
let fetchSpy: ReturnType<typeof vi.fn>

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'free-agent', component: { template: '<div />' } },
      { path: '/sessions', name: 'session-history', component: SessionHistoryView },
      {
        path: '/sessions/:id',
        name: 'session-replay',
        component: { template: '<div />' },
        props: true,
      },
    ],
  })
}

async function mountView(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = makeRouter()
  router.push('/sessions')
  await router.isReady()
  const wrapper = mount(SessionHistoryView, {
    global: { plugins: [router] },
  })
  // Drain the onMounted fetchRecentSessions() chain (it spans multiple
  // microtask boundaries: fetch → .json → store mutation → reactive flush).
  await flushPromises()
  await wrapper.vm.$nextTick()
  return { wrapper, router }
}

function findButton(wrapper: VueWrapper, label: string) {
  return wrapper
    .findAll('goa-button')
    .find((b) => b.text().trim().toLowerCase().includes(label.toLowerCase()))
}

function session(overrides: Partial<{
  id: string
  prompt: string
  modelId: string
  status: string
  classification: string
  createdAt: string
  completedAt: string | null
}> = {}) {
  return {
    id: overrides.id ?? '11111111-2222-3333-4444-555555555555',
    prompt: overrides.prompt ?? 'Summarize the speech.',
    modelId: overrides.modelId ?? 'claude-sonnet-4-6',
    status: overrides.status ?? 'completed',
    classification: overrides.classification ?? 'unclassified',
    createdAt: overrides.createdAt ?? '2026-05-22T10:00:00Z',
    completedAt: overrides.completedAt ?? '2026-05-22T10:05:00Z',
  }
}

function mockSessionsResponse(sessions: ReturnType<typeof session>[]): void {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ sessions }),
      text: async () => JSON.stringify({ sessions }),
    } as unknown as Response)
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  fetchCalls = []
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SessionHistoryView — initial render', () => {
  it('mounts without crashing', async () => {
    mockSessionsResponse([])
    const { wrapper } = await mountView()
    expect(wrapper.exists()).toBe(true)
  })

  it('renders the page heading', async () => {
    mockSessionsResponse([])
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Session history')
  })

  it('fetches /api/users/me/recent-sessions on mount', async () => {
    mockSessionsResponse([session()])
    await mountView()
    expect(fetchCalls.some((c) => c.url.includes('/api/users/me/recent-sessions'))).toBe(true)
  })

  it('shows the empty-state message when no sessions exist', async () => {
    mockSessionsResponse([])
    const { wrapper } = await mountView()
    expect(wrapper.text()).toMatch(/No recent sessions yet/i)
  })

  it('renders one list item per session when data is present', async () => {
    mockSessionsResponse([
      session({ id: 'sess-1', prompt: 'one' }),
      session({ id: 'sess-2', prompt: 'two' }),
    ])
    const { wrapper } = await mountView()
    const items = wrapper.findAll('ul[aria-label="Recent sessions"] li')
    expect(items).toHaveLength(2)
    expect(wrapper.text()).toContain('one')
    expect(wrapper.text()).toContain('two')
  })

  it('renders each session row with its model and classification', async () => {
    mockSessionsResponse([
      session({ modelId: 'claude-haiku-4-5', classification: 'protected_a' }),
    ])
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('claude-haiku-4-5')
    expect(wrapper.text()).toContain('protected_a')
  })
})

describe('SessionHistoryView — filters', () => {
  it('filters by status', async () => {
    mockSessionsResponse([
      session({ id: 'a', prompt: 'done-prompt', status: 'completed' }),
      session({ id: 'b', prompt: 'errored-prompt', status: 'error' }),
    ])
    const { wrapper } = await mountView()
    // Switch the status <select> to "error"
    const select = wrapper.find('select')
    await select.setValue('error')
    await wrapper.vm.$nextTick()
    const items = wrapper.findAll('ul[aria-label="Recent sessions"] li')
    expect(items).toHaveLength(1)
    expect(wrapper.text()).toContain('errored-prompt')
    expect(wrapper.text()).not.toContain('done-prompt')
  })

  it('filters by search needle (case-insensitive)', async () => {
    mockSessionsResponse([
      session({ id: 'a', prompt: 'Alberta budget' }),
      session({ id: 'b', prompt: 'Climate review' }),
    ])
    const { wrapper } = await mountView()
    const input = wrapper.find('goa-input[name="search"]')
    // goa-input emits a CustomEvent named `_change`. We dispatch it manually
    // because @vue/test-utils' trigger() works against bubbling DOM events.
    input.element.dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'climate' } }),
    )
    await wrapper.vm.$nextTick()
    const items = wrapper.findAll('ul[aria-label="Recent sessions"] li')
    expect(items).toHaveLength(1)
    expect(wrapper.text()).toContain('Climate review')
    expect(wrapper.text()).not.toContain('Alberta budget')
  })

  it('shows the "no sessions match" state when filters exclude everything', async () => {
    mockSessionsResponse([session({ prompt: 'one' })])
    const { wrapper } = await mountView()
    const input = wrapper.find('goa-input[name="search"]')
    input.element.dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'no-such-term' } }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/No sessions match/i)
  })
})

describe('SessionHistoryView — actions', () => {
  it('navigates to /sessions/:id when Open is clicked', async () => {
    mockSessionsResponse([session({ id: 'sess-42' })])
    const { wrapper, router } = await mountView()
    const pushSpy = vi.spyOn(router, 'push')
    const openBtn = findButton(wrapper, 'Open')
    expect(openBtn).toBeTruthy()
    await openBtn!.trigger('_click')
    expect(pushSpy).toHaveBeenCalledWith({
      name: 'session-replay',
      params: { id: 'sess-42' },
    })
  })

  it('invokes agentSession.exportTranscript(id) when Download is clicked', async () => {
    mockSessionsResponse([session({ id: 'sess-9' })])
    const { wrapper } = await mountView()
    const agent = useAgentSessionStore()
    const exportSpy = vi.spyOn(agent, 'exportTranscript').mockResolvedValue(undefined)
    const dlBtn = findButton(wrapper, 'Download')
    expect(dlBtn).toBeTruthy()
    await dlBtn!.trigger('_click')
    expect(exportSpy).toHaveBeenCalledWith('sess-9')
  })

  it('disables the Download button while an export is in flight for that row', async () => {
    mockSessionsResponse([session({ id: 'sess-1' })])
    const { wrapper } = await mountView()
    const agent = useAgentSessionStore()
    let resolveExport: () => void = () => {}
    const exportPromise = new Promise<void>((resolve) => {
      resolveExport = resolve
    })
    vi.spyOn(agent, 'exportTranscript').mockReturnValue(exportPromise)

    const dlBtn = findButton(wrapper, 'Download')
    expect(dlBtn).toBeTruthy()
    await dlBtn!.trigger('_click')
    await wrapper.vm.$nextTick()
    // Label flips to "Exporting…" and disabled is set.
    const updatedBtn = findButton(wrapper, 'Exporting')
    expect(updatedBtn).toBeTruthy()
    expect(updatedBtn!.attributes('disabled')).toBeDefined()

    resolveExport()
    await exportPromise
    await flushPromises()
    // Label returns to "Download …" and the row is enabled again.
    const restored = findButton(wrapper, 'Download')
    expect(restored).toBeTruthy()
  })

  it('refreshes the list when the Refresh button is clicked', async () => {
    mockSessionsResponse([session({ id: 'sess-1' })])
    const { wrapper } = await mountView()
    const memory = useUserMemoryStore()
    const refreshSpy = vi.spyOn(memory, 'fetchRecentSessions')
    const refreshBtn = findButton(wrapper, 'Refresh')
    expect(refreshBtn).toBeTruthy()
    await refreshBtn!.trigger('_click')
    expect(refreshSpy).toHaveBeenCalled()
  })
})

describe('SessionHistoryView — error / loading states', () => {
  it('surfaces the userMemory store error when the initial fetch fails', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response)
    const { wrapper } = await mountView()
    expect(wrapper.text()).toMatch(/Couldn.t load recent sessions/i)
  })

  it('truncates very long prompts in the row display', async () => {
    const longPrompt = 'x'.repeat(500)
    mockSessionsResponse([session({ prompt: longPrompt })])
    const { wrapper } = await mountView()
    // The view truncates to 140 chars (+ ellipsis).
    expect(wrapper.text()).toMatch(/x{137}…/)
    // The full 500-x string should NOT appear verbatim.
    expect(wrapper.text().includes('x'.repeat(500))).toBe(false)
  })
})

// ============================================================================
// STAR TOGGLE + STARRED-ONLY FILTER (Bot 19, F8)
// ============================================================================

describe('SessionHistoryView — star toggle', () => {
  it('renders a star toggle button on each row', async () => {
    mockSessionsResponse([
      session({ id: 'sess-1', prompt: 'p1' }),
      session({ id: 'sess-2', prompt: 'p2' }),
    ])
    const { wrapper } = await mountView()
    const stars = wrapper.findAll('[data-testid="row-star-toggle"]')
    expect(stars).toHaveLength(2)
  })

  it('reflects starred=true via aria-pressed on the row toggle', async () => {
    // The server returns one starred row and one unstarred. Each row's
    // aria-pressed reflects its individual state.
    fetchSpy.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({
          sessions: [
            { ...session({ id: 'a' }), starred: true },
            { ...session({ id: 'b' }), starred: false },
          ],
        }),
        text: async () => '',
      } as unknown as Response)
    })
    const { wrapper } = await mountView()
    const stars = wrapper.findAll('[data-testid="row-star-toggle"]')
    expect(stars[0].attributes('aria-pressed')).toBe('true')
    expect(stars[1].attributes('aria-pressed')).toBe('false')
  })

  it('calls userMemory.toggleSessionStar with the inverse value', async () => {
    mockSessionsResponse([session({ id: 'sess-42' })])
    const { wrapper } = await mountView()
    const memory = useUserMemoryStore()
    const toggleSpy = vi.spyOn(memory, 'toggleSessionStar').mockResolvedValue(undefined)

    const star = wrapper.find('[data-testid="row-star-toggle"]')
    await star.trigger('_click')
    expect(toggleSpy).toHaveBeenCalledWith('sess-42', true)
  })

  it('clicking the "Show starred" chip refetches with ?starred=true', async () => {
    mockSessionsResponse([session()])
    const { wrapper } = await mountView()
    // Reset call list so we can isolate the chip's fetch.
    fetchCalls.length = 0
    const chip = wrapper.find('[data-testid="starred-only-toggle"]')
    expect(chip.attributes('aria-pressed')).toBe('false')
    await chip.trigger('_click')
    await flushPromises()
    expect(
      fetchCalls.some((c) => c.url.includes('/api/users/me/recent-sessions') && c.url.includes('starred=true')),
    ).toBe(true)
  })

  it('chip flips to aria-pressed=true after activating', async () => {
    mockSessionsResponse([session()])
    const { wrapper } = await mountView()
    const chip = wrapper.find('[data-testid="starred-only-toggle"]')
    await chip.trigger('_click')
    await flushPromises()
    expect(wrapper.find('[data-testid="starred-only-toggle"]').attributes('aria-pressed')).toBe(
      'true',
    )
  })
})
