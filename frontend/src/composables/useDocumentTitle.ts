/**
 * Keeps `document.title` in sync with a reactive value.
 *
 * Each call sets the title immediately and watches the source. On unmount the
 * title is restored to the base "Agent Builder Console" so a navigation away
 * from a detail page doesn't leave a stale title hanging.
 */

import { onBeforeUnmount, watch, type Ref } from 'vue'

const BASE_TITLE = 'Agent Builder Console'

export function useDocumentTitle(source: Ref<string | null | undefined> | (() => string | null | undefined)): void {
  const get = typeof source === 'function' ? source : () => source.value

  function apply(value: string | null | undefined): void {
    const trimmed = (value ?? '').trim()
    document.title = trimmed ? `${trimmed} · ${BASE_TITLE}` : BASE_TITLE
  }

  apply(get())
  const stop = watch(get, apply)

  onBeforeUnmount(() => {
    stop()
    document.title = BASE_TITLE
  })
}
