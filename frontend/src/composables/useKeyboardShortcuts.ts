/**
 * Reusable global keyboard-shortcut binder.
 *
 * Registers a set of keydown bindings on `window` for the lifetime of the
 * calling component. Each binding is matched on a normalised "combo" string
 * (`ctrl+enter`, `escape`, `meta+i`, …) so callers don't have to think about
 * the platform difference between `Ctrl` (Win/Linux) and `Cmd` (macOS) — both
 * are accepted when the binding requests `mod` or either explicit modifier.
 *
 * Key behaviours:
 *  - Shortcuts that are fired from inside an editable element (`<input>`,
 *    `<textarea>`, `contenteditable`, or any element whose `isContentEditable`
 *    flag is true) are ignored UNLESS the binding opts in via
 *    `allowInEditable: true`. This prevents `Ctrl+Enter` in the Free Agent
 *    prompt textarea from firing while the user is still typing — which is
 *    the ergonomic the §4.2 recommendation asks for.
 *  - Bindings with `preventDefault: true` swallow the browser default once the
 *    handler runs (e.g. `Ctrl+S` won't show the browser's Save Page dialog).
 *  - When the calling component unmounts, the listener is removed so stale
 *    handlers don't fire against a torn-down view.
 *
 * The composable accepts a static array of bindings — there is no reactivity
 * on the binding list itself, which is intentional: the bindings registered
 * for a view are fixed for the view's lifetime, and the handlers themselves
 * close over reactive store state.
 */

import { onBeforeUnmount, onMounted } from 'vue'

export type KeyboardModifier = 'ctrl' | 'meta' | 'mod' | 'shift' | 'alt'

export interface ShortcutBinding {
  /**
   * Combo string: lower-case modifiers joined with `+` followed by the key.
   * Examples: `enter`, `escape`, `ctrl+enter`, `mod+s`, `shift+?`,
   * `ctrl+shift+k`. Use `mod` to match either `ctrl` or `meta` (Cmd on macOS).
   */
  combo: string
  /** Invoked when the combo fires. The original event is passed for inspection. */
  handler: (event: KeyboardEvent) => void
  /** Call `event.preventDefault()` after the handler runs. Defaults to false. */
  preventDefault?: boolean
  /**
   * By default the binder skips events whose target is an editable element so
   * typing inside an `<input>`/`<textarea>` doesn't fire shortcuts. Set true
   * to opt out of that filter (e.g. Esc to close a modal regardless of focus).
   */
  allowInEditable?: boolean
  /** Skip the binding entirely when this predicate returns true. */
  enabled?: () => boolean
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  if (EDITABLE_TAGS.has(target.tagName)) {
    // <input type="checkbox"> etc. shouldn't block shortcuts — only text-ish
    // controls do. Anything not explicitly listed is treated as text-ish.
    if (target instanceof HTMLInputElement) {
      const t = (target.type || 'text').toLowerCase()
      const nonTextual = new Set([
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit',
      ])
      if (nonTextual.has(t)) return false
    }
    return true
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true
  // Some custom Web Components host an internal editable element. We can't
  // see across the shadow root from here, but `target.tagName` for those
  // shows the custom-element name (e.g. GOA-TEXTAREA). Treat any tag that
  // contains 'TEXTAREA' / 'INPUT' as editable.
  const tag = (target as Element).tagName ?? ''
  if (tag.includes('TEXTAREA') || tag.includes('INPUT')) return true
  return false
}

interface ParsedCombo {
  ctrl: boolean
  meta: boolean
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
  const parsed: ParsedCombo = {
    ctrl: false,
    meta: false,
    mod: false,
    shift: false,
    alt: false,
    key: '',
  }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') parsed.ctrl = true
    else if (part === 'meta' || part === 'cmd' || part === 'command') parsed.meta = true
    else if (part === 'mod') parsed.mod = true
    else if (part === 'shift') parsed.shift = true
    else if (part === 'alt' || part === 'option') parsed.alt = true
    else parsed.key = part
  }
  return parsed
}

function normaliseKey(key: string): string {
  // KeyboardEvent.key is "Enter" / "Escape" / "ArrowUp" etc. — lowercase
  // them so the combo strings stay easy to read. Single-char keys are also
  // lowercased so `Ctrl+S` matches Shift-S correctly (the user only needs
  // to add `shift` to the combo when they actually want shift).
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

function matches(parsed: ParsedCombo, event: KeyboardEvent): boolean {
  const wantsMod = parsed.mod
  const ctrlOrMeta = event.ctrlKey || event.metaKey
  if (wantsMod && !ctrlOrMeta) return false
  if (!wantsMod) {
    if (parsed.ctrl !== event.ctrlKey) return false
    if (parsed.meta !== event.metaKey) return false
  }
  if (parsed.shift !== event.shiftKey) return false
  if (parsed.alt !== event.altKey) return false
  return normaliseKey(event.key) === parsed.key
}

/**
 * Register keyboard shortcuts for the calling component's lifetime.
 *
 * Returns nothing — side effects only. The listener is attached on
 * `onMounted` and removed on `onBeforeUnmount`. If the composable is called
 * outside a component setup (rare; e.g. inside a Pinia store) the lifecycle
 * hooks become no-ops, which is the safe Vue default.
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  if (!Array.isArray(bindings) || bindings.length === 0) return

  const parsed = bindings.map((binding) => ({
    binding,
    parsed: parseCombo(binding.combo),
  }))

  function onKeydown(event: KeyboardEvent): void {
    const fromEditable = isEditableTarget(event.target)
    for (const { binding, parsed: combo } of parsed) {
      if (binding.enabled && !binding.enabled()) continue
      if (fromEditable && !binding.allowInEditable) continue
      if (!matches(combo, event)) continue
      binding.handler(event)
      if (binding.preventDefault) event.preventDefault()
      // First match wins. Bindings are checked in registration order, so
      // callers can put the most specific combos first if they overlap.
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
  })
}

// ---- Test-only exports -------------------------------------------------------
// Exposed so the unit tests can verify parsing + filtering logic directly
// without standing up a Vue component. Not part of the public composable API.

export const __internals = {
  isEditableTarget,
  parseCombo,
  normaliseKey,
  matches,
}
