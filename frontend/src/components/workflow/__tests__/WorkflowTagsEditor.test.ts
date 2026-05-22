/**
 * WorkflowTagsEditor unit tests (Bot 17, F5).
 *
 * The component is a small controlled tag chip + input combo. These tests
 * pin the behaviours the toolbar + list view rely on:
 *
 *   - chip rendering for each tag
 *   - remove button on each chip emits the trimmed list
 *   - typing then pressing Enter commits a new tag (lowercased, trimmed)
 *   - duplicate tags are rejected without an emit
 *   - backspace on empty input removes the trailing tag
 *   - readonly mode hides the input + remove buttons
 *   - tag-limit cap (12) prevents further additions
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkflowTagsEditor from '../WorkflowTagsEditor.vue'

describe('WorkflowTagsEditor', () => {
  it('renders one chip per tag', () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education', 'research'] },
    })
    expect(wrapper.find('[data-testid="tag-chip-education"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tag-chip-research"]').exists()).toBe(true)
  })

  it('emits update:tags without a removed tag when × is clicked', async () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education', 'research'] },
    })
    await wrapper.find('[data-testid="tag-remove-education"]').trigger('click')
    const emitted = wrapper.emitted('update:tags')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual(['research'])
  })

  it('commits a new tag on Enter, normalised to lowercase', async () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education'] },
    })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('  Research  ')
    await input.trigger('keydown', { key: 'Enter' })
    const emitted = wrapper.emitted('update:tags')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual(['education', 'research'])
  })

  it('commits on comma keydown too (multi-tag entry)', async () => {
    const wrapper = mount(WorkflowTagsEditor, { props: { tags: [] } })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('education')
    await input.trigger('keydown', { key: ',' })
    expect(wrapper.emitted('update:tags')![0][0]).toEqual(['education'])
  })

  it('does not emit when committing an empty or whitespace-only draft', async () => {
    const wrapper = mount(WorkflowTagsEditor, { props: { tags: [] } })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:tags')).toBeUndefined()
  })

  it('rejects duplicates with a visible error and no emit', async () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education'] },
    })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('education')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:tags')).toBeUndefined()
    expect(wrapper.find('[data-testid="tag-error"]').text()).toMatch(/already added/i)
  })

  it('rejects tags with invalid characters', async () => {
    const wrapper = mount(WorkflowTagsEditor, { props: { tags: [] } })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('with space')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:tags')).toBeUndefined()
    expect(wrapper.find('[data-testid="tag-error"]').exists()).toBe(true)
  })

  it('rejects tags longer than 32 characters', async () => {
    const wrapper = mount(WorkflowTagsEditor, { props: { tags: [] } })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('a'.repeat(33))
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:tags')).toBeUndefined()
  })

  it('removes the trailing chip on backspace when input is empty', async () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education', 'research'] },
    })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('update:tags')![0][0]).toEqual(['education'])
  })

  it('does not remove a chip on backspace when input has content', async () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education'] },
    })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('foo')
    await input.trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('update:tags')).toBeUndefined()
  })

  it('hides the input and × buttons in readonly mode', () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: ['education'], readonly: true },
    })
    expect(wrapper.find('[data-testid="tag-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tag-remove-education"]').exists()).toBe(false)
  })

  it('renders "No tags" in readonly mode when the list is empty', () => {
    const wrapper = mount(WorkflowTagsEditor, {
      props: { tags: [], readonly: true },
    })
    expect(wrapper.text()).toContain('No tags')
  })

  it('disables the input once the 12-tag cap is reached', () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag${i}`)
    const wrapper = mount(WorkflowTagsEditor, { props: { tags } })
    const input = wrapper.find('[data-testid="tag-input"]')
    expect((input.element as HTMLInputElement).disabled).toBe(true)
  })

  it('splits a comma-pasted value into multiple chips inline', async () => {
    const wrapper = mount(WorkflowTagsEditor, { props: { tags: [] } })
    const input = wrapper.find('[data-testid="tag-input"]')
    // Simulate paste: setValue triggers an input event with the comma-joined string.
    await input.setValue('education, research')
    // Each comma-delimited part becomes its own emit.
    const emits = wrapper.emitted('update:tags')
    expect(emits).toBeTruthy()
    expect(emits!.flat()).toContainEqual(['education'])
  })

  it('commits a pending draft when the input loses focus', async () => {
    const wrapper = mount(WorkflowTagsEditor, { props: { tags: [] } })
    const input = wrapper.find('[data-testid="tag-input"]')
    await input.setValue('education')
    await input.trigger('blur')
    expect(wrapper.emitted('update:tags')![0][0]).toEqual(['education'])
  })
})
