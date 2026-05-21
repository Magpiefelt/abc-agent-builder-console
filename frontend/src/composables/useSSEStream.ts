/**
 * Reusable POST + ReadableStream consumer for server-sent events.
 *
 * EventSource cannot send a POST body, so we drive the SSE protocol manually
 * over fetch(). The composable is generic (no agent-session knowledge) so
 * Stream C can reuse it for structured workflow streams.
 *
 * Reconnect policy: we only retry pre-read network failures (DNS hiccup,
 * connection refused, etc.) with exponential backoff. Mid-stream drops are
 * surfaced as 'error' immediately — for endpoints like /sessions/:id/start
 * a blind POST retry would race with the backend's session-lifecycle
 * cleanup and risk a 409. The store reconciles state via GET in onError.
 */

import { ref, type Ref } from 'vue'

export type SSEStreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'done'
  | 'error'

export interface UseSSEStreamOptions<TEvent> {
  onEvent: (event: TEvent) => void
  onError?: (err: Error) => void
  onDone?: () => void
  /** Max pre-read connect retries on transient failures. Default 3. */
  maxRetries?: number
  /** Base delay for exponential backoff (ms). Default 1000 → 1s, 2s, 4s. */
  retryBaseMs?: number
}

export interface UseSSEStreamReturn {
  status: Ref<SSEStreamStatus>
  start: (
    url: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ) => Promise<void>
  abort: () => void
}

export function useSSEStream<TEvent = unknown>(
  options: UseSSEStreamOptions<TEvent>,
): UseSSEStreamReturn {
  const status = ref<SSEStreamStatus>('idle')
  let abortController: AbortController | null = null
  const maxRetries = options.maxRetries ?? 3
  const retryBaseMs = options.retryBaseMs ?? 1000

  function emitEvent(eventBlock: string): void {
    const dataLines: string[] = []
    for (const rawLine of eventBlock.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n')
    try {
      const parsed = JSON.parse(payload) as TEvent
      options.onEvent(parsed)
    } catch (err) {
      options.onError?.(
        err instanceof Error ? err : new Error('Failed to parse SSE payload'),
      )
    }
  }

  async function attemptConnect(
    url: string,
    init: { body?: unknown; headers?: Record<string, string> } | undefined,
    retryCount: number,
  ): Promise<{ stage: 'connected'; response: Response } | { stage: 'failed' } | { stage: 'aborted' }> {
    abortController = new AbortController()
    status.value = retryCount === 0 ? 'connecting' : 'reconnecting'

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(init?.headers ?? {}),
        },
        body: JSON.stringify(init?.body ?? {}),
        signal: abortController.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { stage: 'aborted' }
      if (retryCount < maxRetries) {
        const delay = retryBaseMs * 2 ** retryCount
        await sleep(delay)
        return attemptConnect(url, init, retryCount + 1)
      }
      status.value = 'error'
      options.onError?.(err as Error)
      return { stage: 'failed' }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const message =
        `SSE request failed: ${response.status} ${response.statusText}` +
        (body ? ` — ${body.slice(0, 200)}` : '')
      status.value = 'error'
      options.onError?.(new Error(message))
      return { stage: 'failed' }
    }
    if (!response.body) {
      status.value = 'error'
      options.onError?.(new Error('SSE response had no body.'))
      return { stage: 'failed' }
    }

    return { stage: 'connected', response }
  }

  async function consume(response: Response): Promise<void> {
    status.value = 'streaming'
    const reader = response.body!.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          emitEvent(block)
        }
      }
      if (buffer.trim().length > 0) emitEvent(buffer)
      status.value = 'done'
      options.onDone?.()
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      status.value = 'error'
      options.onError?.(err as Error)
    }
  }

  async function start(
    url: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<void> {
    const result = await attemptConnect(url, init, 0)
    if (result.stage === 'connected') {
      await consume(result.response)
    }
  }

  function abort(): void {
    abortController?.abort()
    abortController = null
    if (status.value !== 'done' && status.value !== 'error') {
      status.value = 'idle'
    }
  }

  return { status, start, abort }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
