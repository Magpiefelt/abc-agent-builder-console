/**
 * Lightweight focus trap for modal dialogs.
 *
 * - Records the element that had focus on mount and restores it on unmount.
 * - Listens for Tab / Shift+Tab and wraps focus inside the container.
 * - Listens for Escape and calls the provided onEscape callback.
 *
 * Pass a ref to the container element; call onMounted/onBeforeUnmount of
 * the component as usual. Returns nothing — side effects only.
 */

import { onBeforeUnmount, onMounted, type Ref, nextTick } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(',')

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  options: { onEscape?: () => void; initialFocus?: () => HTMLElement | null } = {},
): void {
  let previouslyFocused: HTMLElement | null = null

  function getFocusable(): HTMLElement[] {
    const root = containerRef.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null,
    )
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && options.onEscape) {
      event.preventDefault()
      options.onEscape()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = getFocusable()
    if (focusable.length === 0) {
      event.preventDefault()
      containerRef.value?.focus()
      return
    }
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement as HTMLElement | null
    if (event.shiftKey) {
      if (active === first || !containerRef.value?.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMounted(async () => {
    previouslyFocused = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    const initial = options.initialFocus?.() ?? getFocusable()[0] ?? containerRef.value
    initial?.focus()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    previouslyFocused?.focus()
  })
}
