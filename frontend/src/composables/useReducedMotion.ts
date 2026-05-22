/**
 * Tracks the user's `prefers-reduced-motion` setting reactively.
 *
 * Returns a readonly boolean ref. Components can bind to it to disable
 * animations (e.g. Vue Flow `animated` edges, CSS keyframes, autoplay
 * scrolls) when the OS / browser advertises that the user prefers
 * reduced motion.
 *
 * SSR / jsdom safe: when `window.matchMedia` is unavailable the ref
 * defaults to `false` and never throws. The listener is automatically
 * detached on component unmount.
 *
 * Usage:
 *   const reduceMotion = useReducedMotion()
 *   <VueFlow :animated="!reduceMotion" ... />
 */
import { onBeforeUnmount, readonly, ref, type Ref } from 'vue'

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): Readonly<Ref<boolean>> {
  const reduced = ref(false)

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return readonly(reduced)
  }

  const mql = window.matchMedia(MEDIA_QUERY)
  reduced.value = mql.matches

  const onChange = (event: MediaQueryListEvent): void => {
    reduced.value = event.matches
  }

  // addEventListener is the modern API; some older Safari variants only
  // expose addListener. We support both because Vue Flow targets the same
  // browser baseline as the GoA Design System (Safari 13+).
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange)
  } else if (typeof (mql as unknown as { addListener?: (cb: (e: MediaQueryListEvent) => void) => void }).addListener === 'function') {
    (mql as unknown as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(onChange)
  }

  onBeforeUnmount(() => {
    if (typeof mql.removeEventListener === 'function') {
      mql.removeEventListener('change', onChange)
    } else if (typeof (mql as unknown as { removeListener?: (cb: (e: MediaQueryListEvent) => void) => void }).removeListener === 'function') {
      (mql as unknown as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }).removeListener(onChange)
    }
  })

  return readonly(reduced)
}
