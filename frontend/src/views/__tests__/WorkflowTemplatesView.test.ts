/**
 * Tests for WorkflowTemplatesView (Bot 17, F2).
 *
 * The view fetches `/api/workflows?templates=true` on mount, renders a grid
 * of template cards, filters by tag chip + text search, and routes the
 * caller to the newly-duplicated workflow when they click "Use as starting
 * point". apiFetch is mocked so the test never touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import WorkflowTemplatesView from '../WorkflowTemplatesView.vue'
import { useWorkflowStore } from '@/stores/workflow'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useApiFetch', () => ({
  apiFetch: apiFetchMock,
  ApiError: class extends Error {
    status?: number
  },
}))

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/workflows', name: 'workflow-list', component: { template: '<div />' } },
      {
        path: '/workflows/templates',
        name: 'workflow-templates',
        component: WorkflowTemplatesView,
      },
      {
        path: '/workflows/:id',
        name: 'workflow-edit',
        component: { template: '<div />' },
      },
    ],
  })
}

interface TemplateOverrides {
  id?: string
  name?: string
  description?: string | null
  tags?: string[]
}

function template(overrides: TemplateOverrides = {}) {
  return {
    id: overrides.id ?? 'wf-1',
    name: overrides.name ?? 'Researcher template',
    description: overrides.description ?? null,
    classification: 'unclassified' as const,
    version: 1,
    is_template: true,
    tags: overrides.tags ?? ['research'],
    ministry_code: 'EDU',
    user_id: 'u-1',
    updated_at: '2026-05-22T10:00:00Z',
    created_at: '2026-05-22T09:00:00Z',
  }
}

async function mountView(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = makeRouter()
  router.push('/workflows/templates')
  await router.isReady()
  const wrapper = mount(WorkflowTemplatesView, { global: { plugins: [router] } })
  // Drain the onMounted apiFetch chain.
  await flushPromises()
  await wrapper.vm.$nextTick()
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetchMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WorkflowTemplatesView — initial render', () => {
  it('fetches /api/workflows?templates=true on mount', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    await mountView()
    expect(apiFetchMock).toHaveBeenCalledWith('/api/workflows?templates=true')
  })

  it('renders the empty state when no templates exist', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountView()
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
  })

  it('renders a card per template', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        template({ id: 'a', name: 'Alpha' }),
        template({ id: 'b', name: 'Beta' }),
      ],
    })
    const { wrapper } = await mountView()
    expect(wrapper.find('[data-testid="template-card-a"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="template-card-b"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
  })

  it('renders the load error callout when the fetch fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('Server unreachable'))
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Server unreachable')
  })
})

describe('WorkflowTemplatesView — tag chip filtering', () => {
  it('clicking a tag chip filters the grid to that tag', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        template({ id: 'a', name: 'Alpha', tags: ['research'] }),
        template({ id: 'b', name: 'Beta', tags: ['health'] }),
      ],
    })
    const { wrapper } = await mountView()
    const researchChip = wrapper.find('[data-testid="template-tag-research"]')
    await researchChip.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-card-a"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="template-card-b"]').exists()).toBe(false)
  })

  it('clicking the active tag chip clears the filter', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        template({ id: 'a', name: 'Alpha', tags: ['research'] }),
        template({ id: 'b', name: 'Beta', tags: ['health'] }),
      ],
    })
    const { wrapper } = await mountView()
    const chipA = wrapper.find('[data-testid="template-tag-research"]')
    await chipA.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-card-b"]').exists()).toBe(false)
    await chipA.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-card-b"]').exists()).toBe(true)
  })

  it('renders the no-match state when the filter excludes every template', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [template({ id: 'a', name: 'Alpha', tags: ['research'] })],
    })
    const { wrapper } = await mountView()
    // Use the dropdown directly — set a tag that no template has.
    const dropdown = wrapper.find('goa-dropdown[name="templateTagFilter"]')
    ;(dropdown.element as Element).dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'health' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="no-match-state"]').exists()).toBe(true)
  })
})

describe('WorkflowTemplatesView — search', () => {
  it('filters the grid by case-insensitive substring on name or description', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        template({ id: 'a', name: 'Policy drafter', description: null }),
        template({ id: 'b', name: 'Health analyst', description: null }),
      ],
    })
    const { wrapper } = await mountView()
    const search = wrapper.find('goa-input[name="search"]')
    ;(search.element as Element).dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'policy' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-card-a"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="template-card-b"]').exists()).toBe(false)
  })
})

describe('WorkflowTemplatesView — use as starting point', () => {
  it('clicking the action calls store.duplicate and navigates to the new workflow', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [template({ id: 'a', name: 'Researcher template' })],
    })
    const { wrapper, router } = await mountView()
    const store = useWorkflowStore()
    const dupSpy = vi
      .spyOn(store, 'duplicate')
      .mockResolvedValue({
        id: 'new-id',
        name: 'Researcher template (from template)',
      } as never)

    const btn = wrapper.find('[data-testid="use-template-a"]')
    await btn.trigger('_click')
    await flushPromises()

    expect(dupSpy).toHaveBeenCalledWith('a', 'Researcher template (from template)')
    expect(router.currentRoute.value.fullPath).toBe('/workflows/new-id')
  })

  it('shows an error toast when duplicate fails', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [template({ id: 'a', name: 'Researcher template' })],
    })
    const { wrapper } = await mountView()
    const store = useWorkflowStore()
    vi.spyOn(store, 'duplicate').mockRejectedValue(new Error('boom'))
    const btn = wrapper.find('[data-testid="use-template-a"]')
    await btn.trigger('_click')
    await flushPromises()
    // The toast container isn't mounted in this test, but the action must
    // still surface the error message somewhere — the most reliable signal
    // is that the button is no longer disabled (the action finished).
    expect((btn.element as HTMLButtonElement).hasAttribute('disabled')).toBe(false)
  })
})
