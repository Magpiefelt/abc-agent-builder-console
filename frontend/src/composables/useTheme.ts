/**
 * Theme composable — single source of truth for the app's Light / Dark / System
 * preference. Backed by:
 *   1. `localStorage` (immediate, no-network restore on first paint)
 *   2. `user_preferences.theme` from `/api/users/me/preferences` (authoritative
 *      once the auth session is hydrated; written back when the user toggles)
 *
 * The preference is one of `light | dark | system`. `system` resolves at
 * runtime to whichever the user's OS reports via `prefers-color-scheme`.
 *
 * Application strategy: the `data-theme="dark"` attribute is toggled on
 * `<html>`. This matches the official `@abgov/design-tokens` convention so
 * the bundled `dark-theme.css` palette overrides take effect automatically.
 * Light mode is the default (no attribute), so first paint shows light
 * before this module mounts.
 *
 * Designed as module-singleton state — calling `useTheme()` multiple times
 * returns the same reactive refs, so any component (App, Profile, header) can
 * observe and mutate the same theme without prop-drilling.
 */

import { computed, effectScope, readonly, ref, watch, type ComputedRef, type Ref } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'abc.theme'
const THEME_ATTR = 'data-theme'
const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'] as const

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
}

function hasDOM(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

function readStorage(): ThemePreference | null {
  if (!hasDOM()) return null
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    return isThemePreference(raw) ? raw : null
  } catch {
    // SecurityError in strict iframes / Safari private mode.
    return null
  }
}

function writeStorage(preference: ThemePreference): void {
  if (!hasDOM()) return
  try {
    window.localStorage?.setItem(STORAGE_KEY, preference)
  } catch {
    // Best-effort; in-memory ref still drives the current session and the
    // backend preference will catch the next reload.
  }
}

function systemPrefersDark(): boolean {
  if (!hasDOM() || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyToDOM(resolved: ResolvedTheme): void {
  if (!hasDOM()) return
  const root = document.documentElement
  if (resolved === 'dark') {
    root.setAttribute(THEME_ATTR, 'dark')
  } else {
    root.removeAttribute(THEME_ATTR)
  }
  // Inform browsers about the colour-scheme so native form controls and
  // scrollbars match.
  root.style.colorScheme = resolved
}

// ---- Module-singleton state --------------------------------------------------

const preference = ref<ThemePreference>(readStorage() ?? 'system')
const systemIsDark = ref<boolean>(systemPrefersDark())

const resolved: ComputedRef<ResolvedTheme> = computed(() => {
  if (preference.value === 'dark') return 'dark'
  if (preference.value === 'light') return 'light'
  return systemIsDark.value ? 'dark' : 'light'
})

let mediaQuery: MediaQueryList | null = null
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null

function ensureMediaListener(): void {
  if (!hasDOM() || mediaQuery || typeof window.matchMedia !== 'function') return
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaListener = (event) => {
    systemIsDark.value = event.matches
  }
  // Older Safari only exposes addListener; modern browsers expose addEventListener.
  type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
  }
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', mediaListener)
  } else if (typeof (mediaQuery as LegacyMediaQueryList).addListener === 'function') {
    ;(mediaQuery as LegacyMediaQueryList).addListener!(mediaListener)
  }
}

// Set up a detached effect scope so the watcher survives any component
// unmount and stays as a true singleton.
const scope = effectScope(true)
scope.run(() => {
  watch(resolved, (next) => applyToDOM(next), { immediate: true })
})
ensureMediaListener()

// ---- Public API --------------------------------------------------------------

export interface UseThemeReturn {
  /** User's stored preference: light, dark, or system. */
  preference: Readonly<Ref<ThemePreference>>
  /** Resolved colour mode after applying system fallback. */
  resolved: Readonly<Ref<ResolvedTheme>>
  /** Whether the OS currently reports a dark colour scheme. */
  systemIsDark: Readonly<Ref<boolean>>
  /** Update the preference (persists to localStorage + applies to DOM). */
  setTheme(next: ThemePreference): void
  /** Cycle through light → dark → system → light, useful for header toggles. */
  cycleTheme(): void
  /**
   * Sync from the backend `user_preferences.theme` value. Accepts unknown so
   * callers can pass `preferences?.theme` directly without narrowing. Invalid
   * values (null, undefined, unrecognised strings) are ignored.
   */
  syncFromServer(value: unknown): void
}

export function useTheme(): UseThemeReturn {
  ensureMediaListener()

  function setTheme(next: ThemePreference): void {
    if (!isThemePreference(next)) return
    if (preference.value === next) return
    preference.value = next
    writeStorage(next)
  }

  function cycleTheme(): void {
    const order: ThemePreference[] = ['light', 'dark', 'system']
    const idx = order.indexOf(preference.value)
    const nextIdx = idx === -1 ? 0 : (idx + 1) % order.length
    setTheme(order[nextIdx]!)
  }

  function syncFromServer(value: unknown): void {
    if (!isThemePreference(value)) return
    if (preference.value === value) return
    preference.value = value
    writeStorage(value)
  }

  return {
    preference: readonly(preference) as Readonly<Ref<ThemePreference>>,
    resolved: readonly(resolved) as Readonly<Ref<ResolvedTheme>>,
    systemIsDark: readonly(systemIsDark) as Readonly<Ref<boolean>>,
    setTheme,
    cycleTheme,
    syncFromServer,
  }
}

// Test-only escape hatch to reset module state between vitest runs. Not part
// of the public API.
export function __resetThemeForTests(): void {
  preference.value = 'system'
  systemIsDark.value = systemPrefersDark()
  type LegacyMediaQueryList = MediaQueryList & {
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
  }
  if (mediaQuery && mediaListener) {
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', mediaListener)
    } else if (typeof (mediaQuery as LegacyMediaQueryList).removeListener === 'function') {
      ;(mediaQuery as LegacyMediaQueryList).removeListener!(mediaListener)
    }
  }
  mediaQuery = null
  mediaListener = null
  if (hasDOM()) {
    try {
      window.localStorage?.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    document.documentElement.removeAttribute(THEME_ATTR)
    document.documentElement.style.colorScheme = ''
  }
  ensureMediaListener()
  applyToDOM(resolved.value)
}
