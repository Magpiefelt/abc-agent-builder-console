/**
 * Tiny wrapper around fetch() that:
 *  - Always includes credentials so the Entra ID session cookie flows.
 *  - Resets the auth store on 401 so the router guard bounces to /login.
 *  - Throws on non-2xx with the server's error body when present.
 *
 * Use for JSON endpoints. SSE consumers should reuse the `credentials: 'include'`
 * pattern manually via useSSEStream's options.
 */

import { useAuthStore } from '@/stores/auth'

export interface ApiError extends Error {
  status: number
  detail?: unknown
}

export async function apiFetch<T = unknown>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    ...init,
  })

  if (response.status === 401) {
    useAuthStore().reset()
    const err = new Error('Session expired. Please sign in again.') as ApiError
    err.status = 401
    throw err
  }

  if (!response.ok) {
    let detail: unknown = undefined
    const text = await response.text().catch(() => '')
    if (text) {
      try {
        detail = JSON.parse(text)
      } catch {
        detail = text
      }
    }
    const message =
      (detail && typeof detail === 'object' && 'error' in detail && typeof (detail as { error: unknown }).error === 'string'
        ? (detail as { error: string }).error
        : null) ||
      `${response.status} ${response.statusText}`
    const err = new Error(message) as ApiError
    err.status = response.status
    err.detail = detail
    throw err
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
