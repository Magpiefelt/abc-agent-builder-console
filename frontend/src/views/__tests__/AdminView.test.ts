/**
 * Tests for AdminView.
 *
 * AdminView is a tab-host that renders one of six admin panels in a
 * <KeepAlive> slot. The side rail uses goa-work-side-menu and renders the
 * tab list as <a> tags grouped by Operations / Compliance / Configuration.
 * Selection is driven by click handlers (which fire .prevent and call
 * `select(id)`), and the URL hash mirrors `active.value`.
 *
 * To keep the test hermetic we stub every panel component so no admin API
 * calls fire. The web-component shell (<goa-work-side-menu>) is left
 * unstubbed — jsdom renders it as a plain custom element and the inner
 * <a> tags are still queryable via the wrapper.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AdminView from '../AdminView.vue'

const stubs = {
  DashboardPanel: { template: '<div data-stub="DashboardPanel" />' },
  AuditLogViewer: { template: '<div data-stub="AuditLogViewer" />' },
  PIIDetectionViewer: { template: '<div data-stub="PIIDetectionViewer" />' },
  ModelRegistryEditor: { template: '<div data-stub="ModelRegistryEditor" />' },
  SessionInspector: { template: '<div data-stub="SessionInspector" />' },
  HealthDiagnostics: { template: '<div data-stub="HealthDiagnostics" />' },
  TrashPanel: { template: '<div data-stub="TrashPanel" />' },
  BudgetPanel: { template: '<div data-stub="BudgetPanel" />' },
  WebhooksPanel: { template: '<div data-stub="WebhooksPanel" />' },
  EvidencePanel: { template: '<div data-stub="EvidencePanel" />' },
}

function mountWithHash(hash: string): VueWrapper {
  // Reset the hash before mount so the synchronous tabFromHash() picks it up.
  history.replaceState(null, '', `/admin${hash}`)
  return mount(AdminView, { global: { stubs } })
}

function tabLinks(wrapper: VueWrapper) {
  // The view templates a top-level <a slot="links"> per item. In rendered
  // DOM these are direct children of the goa-work-side-menu host element.
  return wrapper.findAll('goa-work-side-menu a')
}

function tabByLabel(wrapper: VueWrapper, label: string) {
  return tabLinks(wrapper).find((a) => a.text().trim() === label)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  history.replaceState(null, '', '/')
})

describe('AdminView — initial render', () => {
  it('mounts without crashing under jsdom', () => {
    const wrapper = mountWithHash('')
    expect(wrapper.exists()).toBe(true)
  })

  it('renders ten tab links across three section groups', () => {
    const wrapper = mountWithHash('')
    const links = tabLinks(wrapper)
    expect(links).toHaveLength(10)
    const labels = links.map((a) => a.text().trim())
    expect(labels).toEqual([
      'Dashboard',
      'Health diagnostics',
      'Audit log',
      'PII detections',
      'Compliance evidence',
      'Model registry',
      'Sessions',
      'Workflow trash',
      'Token budgets',
      'Webhooks',
    ])
  })

  it('renders the three section headings (Operations / Compliance / Configuration)', () => {
    const wrapper = mountWithHash('')
    const text = wrapper.text()
    expect(text).toContain('Operations')
    expect(text).toContain('Compliance')
    expect(text).toContain('Configuration')
  })

  it('defaults to Dashboard when no hash is present', () => {
    const wrapper = mountWithHash('')
    const active = tabLinks(wrapper).find((a) => a.attributes('aria-current') === 'page')!
    expect(active.text().trim()).toBe('Dashboard')
    expect(wrapper.find('section').html()).toContain('data-stub="DashboardPanel"')
  })

  it('selects the Audit tab when the URL hash is #audit', () => {
    const wrapper = mountWithHash('#audit')
    const active = tabLinks(wrapper).find((a) => a.attributes('aria-current') === 'page')!
    expect(active.text().trim()).toBe('Audit log')
    expect(wrapper.find('section').html()).toContain('data-stub="AuditLogViewer"')
  })

  it('falls back to Dashboard when the URL hash is unknown', () => {
    const wrapper = mountWithHash('#not-a-tab')
    const active = tabLinks(wrapper).find((a) => a.attributes('aria-current') === 'page')!
    expect(active.text().trim()).toBe('Dashboard')
  })

  it('selects the Health tab when the URL hash is #health', () => {
    const wrapper = mountWithHash('#health')
    const active = tabLinks(wrapper).find((a) => a.attributes('aria-current') === 'page')!
    expect(active.text().trim()).toBe('Health diagnostics')
    expect(wrapper.find('section').html()).toContain('data-stub="HealthDiagnostics"')
  })
})

describe('AdminView — tab switching', () => {
  it('switching tab updates the active rendered panel', async () => {
    const wrapper = mountWithHash('')
    const sessionsLink = tabByLabel(wrapper, 'Sessions')!
    await sessionsLink.trigger('click')
    const active = tabLinks(wrapper).find((a) => a.attributes('aria-current') === 'page')!
    expect(active.text().trim()).toBe('Sessions')
    expect(wrapper.find('section').html()).toContain('data-stub="SessionInspector"')
  })

  it('switching tab updates window.location.hash', async () => {
    const wrapper = mountWithHash('')
    const piiLink = tabByLabel(wrapper, 'PII detections')!
    await piiLink.trigger('click')
    await wrapper.vm.$nextTick()
    expect(window.location.hash).toBe('#pii')
  })

  it('clicking the already-active tab is idempotent', async () => {
    const wrapper = mountWithHash('#dashboard')
    const dashLink = tabByLabel(wrapper, 'Dashboard')!
    await dashLink.trigger('click')
    const active = tabLinks(wrapper).find((a) => a.attributes('aria-current') === 'page')!
    expect(active.text().trim()).toBe('Dashboard')
    expect(wrapper.find('section').html()).toContain('data-stub="DashboardPanel"')
  })
})

describe('AdminView — accessibility surfaces', () => {
  it('only the active tab carries aria-current="page"', () => {
    const wrapper = mountWithHash('#models')
    const links = tabLinks(wrapper)
    const current = links.filter((a) => a.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]!.text().trim()).toBe('Model registry')
  })

  it('renders the audit-logged callout on the main panel', () => {
    const wrapper = mountWithHash('')
    expect(wrapper.text()).toContain('audit-logged')
  })
})
