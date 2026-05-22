/**
 * Tests for the useKeyboardShortcuts composable.
 *
 * The composable wires `window.addEventListener('keydown', …)` on mount and
 * removes it on unmount. We test by mounting a tiny harness component and
 * dispatching real KeyboardEvent objects from jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useKeyboardShortcuts,
  __internals,
  type ShortcutBinding,
} from '../useKeyboardShortcuts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fire(opts: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    bubbles: true,
    cancelable: true,
  })
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target })
  }
  window.dispatchEvent(event)
  return event
}

function harness(bindings: ShortcutBinding[]) {
  return defineComponent({
    setup() {
      useKeyboardShortcuts(bindings)
      return () => h('div', { id: 'host' })
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// __internals.parseCombo
// ---------------------------------------------------------------------------

describe('parseCombo', () => {
  it('parses single keys with no modifiers', () => {
    expect(__internals.parseCombo('Enter')).toEqual({
      ctrl: false,
      meta: false,
      mod: false,
      shift: false,
      alt: false,
      key: 'enter',
    })
  })

  it('parses ctrl + key', () => {
    const r = __internals.parseCombo('Ctrl+Enter')
    expect(r.ctrl).toBe(true)
    expect(r.key).toBe('enter')
  })

  it('parses mod (cross-platform) + key', () => {
    const r = __internals.parseCombo('mod+s')
    expect(r.mod).toBe(true)
    expect(r.ctrl).toBe(false)
    expect(r.meta).toBe(false)
    expect(r.key).toBe('s')
  })

  it('accepts shift, alt, cmd, option aliases', () => {
    const r = __internals.parseCombo('Cmd+Option+Shift+K')
    expect(r.meta).toBe(true)
    expect(r.alt).toBe(true)
    expect(r.shift).toBe(true)
    expect(r.key).toBe('k')
  })
})

// ---------------------------------------------------------------------------
// __internals.isEditableTarget
// ---------------------------------------------------------------------------

describe('isEditableTarget', () => {
  it('treats plain text-ish inputs as editable', () => {
    const input = document.createElement('input')
    input.type = 'text'
    expect(__internals.isEditableTarget(input)).toBe(true)
  })

  it('treats textarea as editable', () => {
    const t = document.createElement('textarea')
    expect(__internals.isEditableTarget(t)).toBe(true)
  })

  it('treats <input type="checkbox"> as non-editable', () => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    expect(__internals.isEditableTarget(input)).toBe(false)
  })

  it('treats <input type="button"> as non-editable', () => {
    const input = document.createElement('input')
    input.type = 'button'
    expect(__internals.isEditableTarget(input)).toBe(false)
  })

  it('treats contenteditable elements as editable', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    Object.defineProperty(div, 'isContentEditable', { value: true })
    expect(__internals.isEditableTarget(div)).toBe(true)
  })

  it('treats GOA-TEXTAREA web component host as editable', () => {
    const el = document.createElement('goa-textarea')
    expect(__internals.isEditableTarget(el)).toBe(true)
  })

  it('treats null and non-Element targets as non-editable', () => {
    expect(__internals.isEditableTarget(null)).toBe(false)
    expect(__internals.isEditableTarget(window)).toBe(false)
  })

  it('treats regular buttons and divs as non-editable', () => {
    const btn = document.createElement('button')
    const div = document.createElement('div')
    expect(__internals.isEditableTarget(btn)).toBe(false)
    expect(__internals.isEditableTarget(div)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle + binding behaviour
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts — basic firing', () => {
  it('fires the handler for a matching combo', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'ctrl+enter', handler: fn }]))
    fire({ key: 'Enter', ctrlKey: true })
    expect(fn).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not fire when modifiers do not match', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'ctrl+enter', handler: fn }]))
    // Enter without ctrl: no fire.
    fire({ key: 'Enter' })
    // Shift+Enter: no fire.
    fire({ key: 'Enter', shiftKey: true })
    expect(fn).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('mod matches either ctrl or meta', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'mod+s', handler: fn }]))
    fire({ key: 's', ctrlKey: true })
    fire({ key: 's', metaKey: true })
    expect(fn).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('preventDefault calls event.preventDefault when requested', () => {
    const fn = vi.fn()
    const wrapper = mount(
      harness([{ combo: 'mod+s', handler: fn, preventDefault: true }]),
    )
    const event = fire({ key: 's', ctrlKey: true })
    expect(fn).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('does not call preventDefault when preventDefault is false', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'mod+s', handler: fn }]))
    const event = fire({ key: 's', ctrlKey: true })
    expect(fn).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })
})

// ---------------------------------------------------------------------------
// Editable-element filtering
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts — editable-element filtering', () => {
  it('ignores shortcuts fired from inside a textarea by default', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'mod+enter', handler: fn }]))
    const t = document.createElement('textarea')
    document.body.appendChild(t)
    try {
      fire({ key: 'Enter', ctrlKey: true, target: t })
      expect(fn).not.toHaveBeenCalled()
    } finally {
      document.body.removeChild(t)
    }
    wrapper.unmount()
  })

  it('ignores shortcuts fired from a text input by default', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'mod+enter', handler: fn }]))
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    try {
      fire({ key: 'Enter', ctrlKey: true, target: input })
      expect(fn).not.toHaveBeenCalled()
    } finally {
      document.body.removeChild(input)
    }
    wrapper.unmount()
  })

  it('still fires inside a checkbox input (non-editable form control)', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'mod+enter', handler: fn }]))
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    document.body.appendChild(cb)
    try {
      fire({ key: 'Enter', ctrlKey: true, target: cb })
      expect(fn).toHaveBeenCalledOnce()
    } finally {
      document.body.removeChild(cb)
    }
    wrapper.unmount()
  })

  it('honors allowInEditable: true to fire inside text controls', () => {
    const fn = vi.fn()
    const wrapper = mount(
      harness([{ combo: 'escape', handler: fn, allowInEditable: true }]),
    )
    const t = document.createElement('textarea')
    document.body.appendChild(t)
    try {
      fire({ key: 'Escape', target: t })
      expect(fn).toHaveBeenCalledOnce()
    } finally {
      document.body.removeChild(t)
    }
    wrapper.unmount()
  })
})

// ---------------------------------------------------------------------------
// Multiple bindings, predicate, ordering
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts — multiple bindings', () => {
  it('dispatches each binding by its own combo', () => {
    const a = vi.fn()
    const b = vi.fn()
    const wrapper = mount(
      harness([
        { combo: 'mod+enter', handler: a },
        { combo: 'escape', handler: b },
      ]),
    )
    fire({ key: 'Enter', ctrlKey: true })
    fire({ key: 'Escape' })
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('skips bindings whose enabled predicate returns false', () => {
    const fn = vi.fn()
    let allow = false
    const wrapper = mount(
      harness([{ combo: 'mod+enter', handler: fn, enabled: () => allow }]),
    )
    fire({ key: 'Enter', ctrlKey: true })
    expect(fn).not.toHaveBeenCalled()
    allow = true
    fire({ key: 'Enter', ctrlKey: true })
    expect(fn).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('first registered combo wins when two match the same event', () => {
    const a = vi.fn()
    const b = vi.fn()
    const wrapper = mount(
      harness([
        { combo: 'mod+enter', handler: a },
        { combo: 'mod+enter', handler: b },
      ]),
    )
    fire({ key: 'Enter', ctrlKey: true })
    expect(a).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts — cleanup on unmount', () => {
  it('removes the keydown listener so handlers stop firing after unmount', () => {
    const fn = vi.fn()
    const wrapper = mount(harness([{ combo: 'mod+enter', handler: fn }]))
    fire({ key: 'Enter', ctrlKey: true })
    expect(fn).toHaveBeenCalledOnce()

    wrapper.unmount()
    fn.mockClear()
    fire({ key: 'Enter', ctrlKey: true })
    expect(fn).not.toHaveBeenCalled()
  })

  it('no-op when given an empty bindings array (and unmounts cleanly)', () => {
    const wrapper = mount(harness([]))
    // Should not throw on unmount.
    expect(() => wrapper.unmount()).not.toThrow()
  })
})
