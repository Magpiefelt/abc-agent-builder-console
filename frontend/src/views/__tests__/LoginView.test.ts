/**
 * Tests for LoginView.
 *
 * The view is intentionally minimal: render a sign-in button, surface either
 * an auth-store error or a router-query error, and call `auth.login(returnTo)`
 * when the button is clicked. We mount with vue-router's memory history so we
 * can drive route queries deterministically, and we mock `auth.login` so we
 * don't actually navigate the test runner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import LoginView from '../LoginView.vue'
import { useAuthStore } from '@/stores/auth'

function makeRouter(initial = '/login'): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: LoginView },
    ],
    // Tests push to '/login?…' explicitly via router.push; the initial
    // route is just a placeholder.
    ...{ initial },
  })
}

async function mountAt(routePath: string) {
  const router = makeRouter()
  router.push(routePath)
  await router.isReady()
  const wrapper = mount(LoginView, {
    global: { plugins: [router] },
  })
  return { wrapper, router }
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  // Default: /api/auth/me returns 401 so the store's onMounted fetchMe()
  // resolves cleanly without throwing in jsdom.
  fetchSpy = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({}),
  })
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LoginView — render', () => {
  it('mounts without crashing and exposes the sign-in landmark', async () => {
    const { wrapper } = await mountAt('/login')
    // The view is a <section aria-label="Sign in"> with the heading rendered
    // as the `heading` attribute on the GoA container. We assert the landmark
    // rather than an <h1>, which the GoA design tokens own internally.
    const root = wrapper.find('section[aria-label="Sign in"]')
    expect(root.exists()).toBe(true)
    // At least one container with a "Sign in" heading is present.
    const container = wrapper.find('goa-container[heading*="Sign in"]')
    expect(container.exists()).toBe(true)
  })

  it('renders the sign-in button', async () => {
    const { wrapper } = await mountAt('/login')
    const btn = wrapper.find('goa-button')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toMatch(/Sign in|Checking/)
  })

  it('does not render an error callout when there is no error', async () => {
    const { wrapper } = await mountAt('/login')
    expect(wrapper.find('goa-callout').exists()).toBe(false)
  })
})

describe('LoginView — error surfacing', () => {
  it('renders the query-string error message (decoded) when present', async () => {
    const { wrapper } = await mountAt(
      '/login?error=' + encodeURIComponent('Single sign-on failed.'),
    )
    const callout = wrapper.find('goa-callout')
    expect(callout.exists()).toBe(true)
    expect(callout.text()).toContain('Single sign-on failed.')
  })

  it('falls back to the auth store error when no query error is present', async () => {
    const { wrapper } = await mountAt('/login')
    const auth = useAuthStore()
    auth.error = 'Server unreachable'
    await wrapper.vm.$nextTick()
    const callout = wrapper.find('goa-callout')
    expect(callout.exists()).toBe(true)
    expect(callout.text()).toContain('Server unreachable')
  })

  it('query error wins over store error when both present', async () => {
    const { wrapper } = await mountAt(
      '/login?error=' + encodeURIComponent('Query says no'),
    )
    const auth = useAuthStore()
    auth.error = 'Store says no'
    await wrapper.vm.$nextTick()
    const callout = wrapper.find('goa-callout')
    expect(callout.text()).toContain('Query says no')
    expect(callout.text()).not.toContain('Store says no')
  })
})

describe('LoginView — sign-in button interaction', () => {
  it('calls auth.login(returnTo) when the button is clicked', async () => {
    const { wrapper } = await mountAt('/login?returnTo=/workflows')
    const auth = useAuthStore()
    const loginSpy = vi.spyOn(auth, 'login').mockImplementation(() => {})

    // goa-button emits `_click`; in jsdom we synthesise it.
    const btn = wrapper.find('goa-button')
    await btn.trigger('_click')

    expect(loginSpy).toHaveBeenCalledWith('/workflows')
  })

  it('uses "/" as the default returnTo when none is provided', async () => {
    const { wrapper } = await mountAt('/login')
    const auth = useAuthStore()
    const loginSpy = vi.spyOn(auth, 'login').mockImplementation(() => {})

    await wrapper.find('goa-button').trigger('_click')
    expect(loginSpy).toHaveBeenCalledWith('/')
  })

  it('ignores absolute or scheme-bearing returnTo values', async () => {
    // returnTo must start with "/" — anything else falls back to "/".
    const { wrapper } = await mountAt('/login?returnTo=https://evil.example.com')
    const auth = useAuthStore()
    const loginSpy = vi.spyOn(auth, 'login').mockImplementation(() => {})
    await wrapper.find('goa-button').trigger('_click')
    expect(loginSpy).toHaveBeenCalledWith('/')
  })

  it('shows the "Checking your session…" copy while auth.loading is true', async () => {
    const { wrapper } = await mountAt('/login')
    const auth = useAuthStore()
    auth.loading = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('goa-button').text()).toContain('Checking your session')
  })
})

describe('LoginView — auth bootstrap', () => {
  it('fetches /api/auth/me on mount when no prior fetch happened', async () => {
    await mountAt('/login')
    // The auth store calls fetch('/api/auth/me', …) on mount via the view.
    expect(fetchSpy).toHaveBeenCalled()
    const url = fetchSpy.mock.calls[0]![0]
    expect(String(url)).toContain('/api/auth/me')
  })

  it('skips the fetch if auth.fetched is already true', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.fetched = true
    const router = makeRouter()
    router.push('/login')
    await router.isReady()
    fetchSpy.mockClear()
    mount(LoginView, { global: { plugins: [router] } })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
