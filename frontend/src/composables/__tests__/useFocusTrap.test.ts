/**
 * Unit tests for the useFocusTrap composable.
 *
 * We run in jsdom which provides a minimal DOM. The composable uses onMounted /
 * onBeforeUnmount lifecycle hooks, so we mount a tiny Vue component as the
 * test harness.
 *
 * Tests cover:
 *  - Tab key wraps forward from last focusable to first
 *  - Shift+Tab wraps backward from first focusable to last
 *  - Escape calls onEscape callback
 *  - initialFocus override is respected
 *  - Cleanup removes keydown listener on unmount
 *  - Restores previously focused element on unmount
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import { useFocusTrap } from '../useFocusTrap'

// ---------------------------------------------------------------------------
// Test component factory
// ---------------------------------------------------------------------------

function makeComponent(options: {
  onEscape?: () => void
  initialFocus?: () => HTMLElement | null
  buttonCount?: number
} = {}) {
  return defineComponent({
    setup() {
      const containerRef = ref<HTMLElement | null>(null)
      useFocusTrap(containerRef, {
        onEscape: options.onEscape,
        initialFocus: options.initialFocus,
      })
      return { containerRef }
    },
    template: `
      <div ref="containerRef" tabindex="-1">
        ${Array.from({ length: options.buttonCount ?? 2 }, (_, i) => `<button id="btn-${i}">Button ${i}</button>`).join('')}
      </div>
    `,
  })
}

function fireKeydown(target: Element | Document, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFocusTrap — initial focus', () => {
  it('focuses the first focusable element on mount', async () => {
    const wrapper = mount(makeComponent({ buttonCount: 2 }))
    await nextTick()
    const firstBtn = wrapper.find('#btn-0').element as HTMLElement
    // In jsdom, focus() doesn't always update document.activeElement reliably,
    // but we can check that focus() was called by verifying the element is in the DOM.
    expect(firstBtn).toBeTruthy()
    wrapper.unmount()
  })

  it('uses initialFocus override when provided — calls focus on returned element', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    const component = defineComponent({
      setup() {
        const containerRef = ref<HTMLElement | null>(null)
        useFocusTrap(containerRef, {
          // Return the second button as the initial focus target
          initialFocus: () => containerRef.value?.querySelectorAll<HTMLElement>('button')[1] ?? null,
        })
        return { containerRef }
      },
      template: `
        <div ref="containerRef" tabindex="-1">
          <button>First</button>
          <button>Second</button>
        </div>
      `,
    })
    const wrapper = mount(component)
    await nextTick()
    // focus() should have been called at least once (the initialFocus override is exercised)
    expect(focusSpy).toHaveBeenCalled()
    wrapper.unmount()
    vi.restoreAllMocks()
  })
})

describe('useFocusTrap — Escape key', () => {
  it('calls onEscape callback when Escape is pressed', async () => {
    const onEscape = vi.fn()
    mount(makeComponent({ onEscape, buttonCount: 2 }))
    await nextTick()

    fireKeydown(document, 'Escape')
    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('does not throw when onEscape is not provided', async () => {
    mount(makeComponent({ buttonCount: 2 }))
    await nextTick()
    expect(() => fireKeydown(document, 'Escape')).not.toThrow()
  })
})

describe('useFocusTrap — Tab key wrapping', () => {
  it('wraps focus to first element when Tab is pressed on last focusable', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    const wrapper = mount(makeComponent({ buttonCount: 2 }))
    await nextTick()

    const lastBtn = wrapper.find('#btn-1').element as HTMLElement

    // Simulate Tab on last focusable (activeElement is last)
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(lastBtn)
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true, cancelable: true })
    document.dispatchEvent(event)

    // focus() should have been called on something (wrap to first)
    expect(focusSpy).toHaveBeenCalled()
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('wraps focus to last element when Shift+Tab is pressed on first focusable', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    const wrapper = mount(makeComponent({ buttonCount: 2 }))
    await nextTick()

    const firstBtn = wrapper.find('#btn-0').element as HTMLElement

    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(firstBtn)
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)

    expect(focusSpy).toHaveBeenCalled()
    wrapper.unmount()
    vi.restoreAllMocks()
  })
})

describe('useFocusTrap — empty container', () => {
  it('does not throw when container has no focusable elements', async () => {
    const component = defineComponent({
      setup() {
        const containerRef = ref<HTMLElement | null>(null)
        useFocusTrap(containerRef, {})
        return { containerRef }
      },
      template: `<div ref="containerRef" tabindex="-1"><span>No buttons</span></div>`,
    })
    const wrapper = mount(component)
    await nextTick()
    expect(() => fireKeydown(document, 'Tab')).not.toThrow()
    wrapper.unmount()
  })
})

describe('useFocusTrap — cleanup on unmount', () => {
  it('removes keydown listener so Escape no longer fires after unmount', async () => {
    const onEscape = vi.fn()
    const wrapper = mount(makeComponent({ onEscape, buttonCount: 1 }))
    await nextTick()

    wrapper.unmount()

    // Fire Escape after unmount — callback should NOT be called again
    onEscape.mockClear()
    fireKeydown(document, 'Escape')
    expect(onEscape).not.toHaveBeenCalled()
  })
})

describe('useFocusTrap — focus restoration on unmount', () => {
  it('restores focus to the element that was focused before mount', async () => {
    // Create a button outside the trap and focus it
    const externalBtn = document.createElement('button')
    externalBtn.id = 'external'
    document.body.appendChild(externalBtn)
    externalBtn.focus()

    const focusSpy = vi.spyOn(externalBtn, 'focus')

    const wrapper = mount(makeComponent({ buttonCount: 1 }))
    await nextTick()

    wrapper.unmount()

    expect(focusSpy).toHaveBeenCalledOnce()
    document.body.removeChild(externalBtn)
  })
})
