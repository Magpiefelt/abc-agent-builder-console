/**
 * Tests for WorkflowListView.
 *
 * The view renders the user's workflows in a goa-table, with a search box,
 * a "mine" / "all accessible" ministry filter, a JSON import button, and a
 * "New workflow" creation flow. Each row exposes "Use as template" (which
 * calls workflow.duplicate) and "Delete" (which opens a confirm modal that
 * calls workflow.remove on confirm).
 *
 * We mock apiFetch so the test never hits the network. The store actions
 * themselves are exercised against the mock — that is, we verify the view
 * calls the right store method with the right arguments, not that the
 * store does the right thing (the store has its own dedicated tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import WorkflowListView from '../WorkflowListView.vue'
import { useWorkflowStore } from '@/stores/workflow'
import { useAuthStore } from '@/stores/auth'

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
      { path: '/workflows', name: 'workflows', component: WorkflowListView },
      {
        path: '/workflows/:id',
        name: 'workflow-edit',
        component: { template: '<div />' },
      },
    ],
  })
}

async function mountList(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = makeRouter()
  router.push('/workflows')
  await router.isReady()
  const wrapper = mount(WorkflowListView, {
    global: { plugins: [router] },
  })
  // Wait one tick so the onMounted loadList() resolves.
  await Promise.resolve()
  await wrapper.vm.$nextTick()
  return { wrapper, router }
}

function workflow(
  overrides: Partial<{
    id: string
    name: string
    ministry_code: string | null
    description: string | null
    tags: string[]
  }> = {},
) {
  return {
    id: overrides.id ?? 'wf-1',
    name: overrides.name ?? 'My workflow',
    description: overrides.description ?? null,
    classification: 'unclassified' as const,
    version: 1,
    is_template: false,
    tags: overrides.tags ?? [],
    ministry_code: overrides.ministry_code === undefined ? 'EDU' : overrides.ministry_code,
    user_id: 'u-1',
    updated_at: '2026-05-22T10:00:00Z',
    created_at: '2026-05-22T09:00:00Z',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetchMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WorkflowListView — initial render', () => {
  it('mounts without crashing', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()
    expect(wrapper.exists()).toBe(true)
  })

  it('shows the empty state when no workflows exist', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()
    expect(wrapper.text()).toContain('No workflows yet')
  })

  it('renders the workflows table when data is present', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [workflow({ id: 'wf-1', name: 'Researcher' })],
    })
    const { wrapper } = await mountList()
    // Ministry default is 'mine' which filters to user.ministryCode === wf.ministry_code.
    // The unauthenticated test user has no ministryCode, so ALL workflows pass.
    expect(wrapper.find('goa-table').exists()).toBe(true)
    expect(wrapper.text()).toContain('Researcher')
  })

  it('renders the search input, ministry dropdown, import button, and create button', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()
    expect(wrapper.find('goa-input[name="search"]').exists()).toBe(true)
    expect(wrapper.find('goa-dropdown[name="ministryFilter"]').exists()).toBe(true)
    expect(wrapper.findAll('goa-button').some((b) => b.text().includes('Import'))).toBe(true)
    expect(wrapper.findAll('goa-button').some((b) => b.text().includes('New workflow'))).toBe(true)
  })
})

describe('WorkflowListView — ministry filter', () => {
  it("hides workflows from other ministries when filter is 'mine' and user has a ministryCode", async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Mine', ministry_code: 'EDU' }),
        workflow({ id: 'wf-2', name: 'Theirs', ministry_code: 'HEALTH' }),
      ],
    })
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = {
      id: 'u-1',
      displayName: 'Test User',
      email: 't@gov.ab.ca',
      ministryCode: 'EDU',
      role: 'user',
    } as never
    const router = makeRouter()
    router.push('/workflows')
    await router.isReady()
    const wrapper = mount(WorkflowListView, { global: { plugins: [router] } })
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Mine')
    expect(wrapper.text()).not.toContain('Theirs')
  })

  it("shows all workflows when filter is 'ministry' (all accessible)", async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Mine', ministry_code: 'EDU' }),
        workflow({ id: 'wf-2', name: 'Theirs', ministry_code: 'HEALTH' }),
      ],
    })
    const auth = useAuthStore()
    auth.user = {
      id: 'u-1',
      displayName: 'Test User',
      email: 't@gov.ab.ca',
      ministryCode: 'EDU',
      role: 'user',
    } as never
    const router = makeRouter()
    router.push('/workflows')
    await router.isReady()
    const wrapper = mount(WorkflowListView, { global: { plugins: [router] } })
    await wrapper.vm.$nextTick()
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    // Flip the dropdown to 'ministry' (all accessible).
    const dropdown = wrapper.find('goa-dropdown[name="ministryFilter"]')
    await dropdown.trigger('_change', { detail: { value: 'ministry' } })
    // The handler reads e.detail.value via the @_change listener. Vue Test
    // Utils synthesises a CustomEvent with the detail when we trigger; if
    // that pattern fails we manually dispatch.
    const host = dropdown.element as Element
    host.dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'ministry' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Mine')
    expect(wrapper.text()).toContain('Theirs')
  })
})

describe('WorkflowListView — search', () => {
  it('filters rows by case-insensitive substring match on name or description', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Foo Bot' }),
        workflow({ id: 'wf-2', name: 'Bar Helper' }),
      ],
    })
    const { wrapper } = await mountList()
    const search = wrapper.find('goa-input[name="search"]')
    const host = search.element as Element
    host.dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'foo' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Foo Bot')
    expect(wrapper.text()).not.toContain('Bar Helper')
  })
})

describe('WorkflowListView — create flow', () => {
  it('toggles the inline create form when "New workflow" is clicked', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()

    const newBtn = wrapper.findAll('goa-button').find((b) => b.text().includes('New workflow'))!
    expect(wrapper.find('goa-input[name="newName"]').exists()).toBe(false)
    await newBtn.trigger('_click')
    expect(wrapper.find('goa-input[name="newName"]').exists()).toBe(true)
  })

  it('calls store.create when Create is clicked with a non-empty name', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()

    const store = useWorkflowStore()
    const createSpy = vi
      .spyOn(store, 'create')
      .mockResolvedValue(workflow({ id: 'new-id', name: 'Hello' }) as never)

    const newBtn = wrapper.findAll('goa-button').find((b) => b.text().includes('New workflow'))!
    await newBtn.trigger('_click')

    // Type into the name input.
    const nameInput = wrapper.find('goa-input[name="newName"]')
    ;(nameInput.element as Element).dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'Hello' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()

    const createBtn = wrapper.findAll('goa-button').find((b) => b.text() === 'Create')!
    await createBtn.trigger('_click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(createSpy).toHaveBeenCalledWith('Hello')
  })

  it('does not call store.create when name is whitespace-only', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()
    const store = useWorkflowStore()
    const createSpy = vi.spyOn(store, 'create').mockResolvedValue({} as never)

    const newBtn = wrapper.findAll('goa-button').find((b) => b.text().includes('New workflow'))!
    await newBtn.trigger('_click')
    // No typing — Create button should be disabled but even if triggered,
    // the handler refuses an empty name.
    const createBtn = wrapper.findAll('goa-button').find((b) => b.text() === 'Create')!
    await createBtn.trigger('_click')

    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe('WorkflowListView — row actions', () => {
  it('clicking "Use as template" delegates to store.duplicate', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [workflow({ id: 'wf-1', name: 'Source', ministry_code: null })],
    })
    const { wrapper } = await mountList()
    const store = useWorkflowStore()
    const dupSpy = vi
      .spyOn(store, 'duplicate')
      .mockResolvedValue(workflow({ id: 'wf-1-copy', name: 'Source (copy)' }) as never)

    const useBtn = wrapper.findAll('goa-button').find((b) => b.text().includes('Use as template'))!
    await useBtn.trigger('_click')
    await Promise.resolve()
    expect(dupSpy).toHaveBeenCalledWith('wf-1')
  })

  it('clicking Delete opens the confirm modal; clicking Cancel dismisses it', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [workflow({ id: 'wf-1', name: 'To Delete', ministry_code: null })],
    })
    const { wrapper } = await mountList()

    expect(wrapper.find('goa-modal').exists()).toBe(false)
    const delBtn = wrapper.findAll('goa-button').find((b) => b.text() === 'Delete')!
    await delBtn.trigger('_click')
    expect(wrapper.find('goa-modal').exists()).toBe(true)

    // Cancel button inside the modal.
    const cancelBtn = wrapper.findAll('goa-button').find((b) => b.text() === 'Cancel')!
    await cancelBtn.trigger('_click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('goa-modal').exists()).toBe(false)
  })

  it('confirming the delete modal calls store.remove with the row id', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [workflow({ id: 'wf-1', name: 'Doomed', ministry_code: null })],
    })
    const { wrapper } = await mountList()
    const store = useWorkflowStore()
    const removeSpy = vi.spyOn(store, 'remove').mockResolvedValue(undefined as never)

    await wrapper.findAll('goa-button').find((b) => b.text() === 'Delete')!.trigger('_click')
    // The modal renders TWO "Delete" buttons (the row and the modal); confirm
    // uses the destructive variant inside the modal slot.
    const confirmBtn = wrapper.findAll('goa-button').filter((b) => b.text() === 'Delete').at(-1)!
    await confirmBtn.trigger('_click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(removeSpy).toHaveBeenCalledWith('wf-1')
  })
})

describe('WorkflowListView — tag filter (Bot 17, F5)', () => {
  it('shows the tag filter dropdown when at least one tagged workflow is present', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Alpha', ministry_code: null, tags: ['education'] }),
      ],
    })
    const { wrapper } = await mountList()
    expect(wrapper.find('goa-dropdown[name="tagFilter"]').exists()).toBe(true)
  })

  it('omits the tag filter when every workflow is untagged', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Alpha', ministry_code: null, tags: [] }),
      ],
    })
    const { wrapper } = await mountList()
    expect(wrapper.find('goa-dropdown[name="tagFilter"]').exists()).toBe(false)
  })

  it('filters rows to ones whose tags contain the selected tag', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Alpha', ministry_code: null, tags: ['education'] }),
        workflow({ id: 'wf-2', name: 'Beta', ministry_code: null, tags: ['health'] }),
      ],
    })
    const { wrapper } = await mountList()
    const dropdown = wrapper.find('goa-dropdown[name="tagFilter"]')
    ;(dropdown.element as Element).dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'education' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).not.toContain('Beta')
  })

  it('renders a chip per tag on each row', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({
          id: 'wf-1',
          name: 'Alpha',
          ministry_code: null,
          tags: ['education', 'research'],
        }),
      ],
    })
    const { wrapper } = await mountList()
    expect(wrapper.find('[data-testid="tag-chip-education"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tag-chip-research"]').exists()).toBe(true)
  })

  it('exposes a Browse templates link in the header', async () => {
    apiFetchMock.mockResolvedValueOnce({ workflows: [] })
    const { wrapper } = await mountList()
    const link = wrapper.find('[data-testid="templates-link"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/workflows/templates')
  })

  it('the text search matches against tag values too', async () => {
    apiFetchMock.mockResolvedValueOnce({
      workflows: [
        workflow({ id: 'wf-1', name: 'Alpha', ministry_code: null, tags: ['education'] }),
        workflow({ id: 'wf-2', name: 'Beta', ministry_code: null, tags: ['health'] }),
      ],
    })
    const { wrapper } = await mountList()
    const search = wrapper.find('goa-input[name="search"]')
    ;(search.element as Element).dispatchEvent(
      new CustomEvent('_change', { detail: { value: 'health' }, bubbles: true }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Beta')
    expect(wrapper.text()).not.toContain('Alpha')
  })
})
