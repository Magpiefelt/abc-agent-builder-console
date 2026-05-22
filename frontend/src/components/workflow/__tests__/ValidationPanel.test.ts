/**
 * ValidationPanel renders the result of `validateCanvas`. Tests seed the
 * result + nodes directly so the suite is hermetic.
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ValidationPanel from '../ValidationPanel.vue'
import type {
  IssueSeverity,
  ValidationIssue,
  ValidationResult,
} from '@/lib/workflowValidator'
import type { CanvasNode } from '@/types/workflow'

function issue(
  overrides: Partial<ValidationIssue> & Pick<ValidationIssue, 'code' | 'severity' | 'message'>,
): ValidationIssue {
  return {
    nodeId: null,
    ...overrides,
  }
}

function result(issues: ValidationIssue[]): ValidationResult {
  let error = 0
  let warning = 0
  let info = 0
  for (const i of issues) {
    if (i.severity === 'error') error++
    else if (i.severity === 'warning') warning++
    else info++
  }
  return {
    issues,
    counts: { error, warning, info, total: issues.length },
    runnable: error === 0,
  }
}

function agentNode(id: string, label = id): CanvasNode {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      label,
      modelId: 'claude-haiku-4-5',
      classification: 'unclassified',
      tools: [],
    },
  }
}

describe('ValidationPanel', () => {
  it('shows an empty-state when no issues are present', () => {
    const wrapper = mount(ValidationPanel, {
      props: { result: result([]), nodes: [agentNode('a')] },
    })
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('ready to run')
  })

  it('renders one row per issue with the message', () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'agent_missing_model', severity: 'error', nodeId: 'a', message: 'Agent "a" has no model selected.' }),
      issue({ code: 'orphan_node', severity: 'warning', nodeId: 'b', message: 'Node "b" has no connections — it will never run.' }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [agentNode('a'), agentNode('b')] },
    })
    expect(wrapper.find('[data-testid="issue-agent_missing_model"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="issue-orphan_node"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Agent "a" has no model selected.')
    expect(wrapper.text()).toContain('Node "b" has no connections')
  })

  it('sorts errors above warnings above info', () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'multiple_entries', severity: 'info', message: 'i' }),
      issue({ code: 'orphan_node', severity: 'warning', nodeId: 'b', message: 'w' }),
      issue({ code: 'cycle', severity: 'error', nodeId: 'a', message: 'e' }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [agentNode('a'), agentNode('b')] },
    })
    const rows = wrapper.findAll('[data-testid^="issue-"]')
    expect(rows[0].attributes('data-testid')).toBe('issue-cycle')
    expect(rows[1].attributes('data-testid')).toBe('issue-orphan_node')
    expect(rows[2].attributes('data-testid')).toBe('issue-multiple_entries')
  })

  it('shows counts in the header', () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'cycle', severity: 'error', nodeId: 'a', message: 'e' }),
      issue({ code: 'cycle', severity: 'error', nodeId: 'b', message: 'e2' }),
      issue({ code: 'no_terminal', severity: 'warning', message: 'w' }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [agentNode('a'), agentNode('b')] },
    })
    const headerText = wrapper.find('header').text()
    expect(headerText).toContain('2 errors')
    expect(headerText).toContain('1 warning')
  })

  it('emits select(nodeId) when a row with a nodeId is clicked', async () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'agent_missing_model', severity: 'error', nodeId: 'agent-1', message: 'm' }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [agentNode('agent-1', 'Researcher')] },
    })
    await wrapper.find('[data-testid="issue-agent_missing_model"]').trigger('click')
    const events = wrapper.emitted('select')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['agent-1'])
  })

  it('does NOT emit select for graph-wide issues (nodeId === null)', async () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'multiple_entries', severity: 'info', message: 'i', nodeId: null }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [] },
    })
    await wrapper.find('[data-testid="issue-multiple_entries"]').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('emits select when Enter or Space is pressed on a row', async () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'cycle', severity: 'error', nodeId: 'a', message: 'm' }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [agentNode('a')] },
    })
    const row = wrapper.find('[data-testid="issue-cycle"]')
    await row.trigger('keydown', { key: 'Enter' })
    await row.trigger('keydown', { key: ' ' })
    const events = wrapper.emitted('select')
    expect(events?.length).toBe(2)
  })

  it('emits close when the close button is clicked', async () => {
    const wrapper = mount(ValidationPanel, {
      props: { result: result([]), nodes: [] },
    })
    await wrapper.find('[aria-label="Close validation panel"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows the node kind label when the node exists', () => {
    const issues: ValidationIssue[] = [
      issue({ code: 'agent_missing_model', severity: 'error', nodeId: 'a', message: 'm' }),
    ]
    const wrapper = mount(ValidationPanel, {
      props: { result: result(issues), nodes: [agentNode('a')] },
    })
    expect(wrapper.text()).toContain('Agent')
  })

  it('applies severity-specific styling', () => {
    const severities: IssueSeverity[] = ['error', 'warning', 'info']
    for (const sev of severities) {
      const issues: ValidationIssue[] = [
        issue({ code: 'cycle', severity: sev, nodeId: 'a', message: 'm' }),
      ]
      const wrapper = mount(ValidationPanel, {
        props: { result: result(issues), nodes: [agentNode('a')] },
      })
      const row = wrapper.find('[data-testid="issue-cycle"]')
      // Each severity uses a different left-border colour token.
      const cls = row.classes().join(' ')
      if (sev === 'error') expect(cls).toContain('border-l-[var(--goa-color-emergency)]')
      if (sev === 'warning') expect(cls).toContain('border-l-[var(--goa-color-warning')
      if (sev === 'info') expect(cls).toContain('border-l-[var(--goa-color-information')
    }
  })
})
