/**
 * Reusable POST + ReadableStream consumer for server-sent events.
 *
 * EventSource cannot send a POST body, so we drive the SSE protocol manually
 * over fetch(). The composable is generic (no agent-session knowledge) so
 * Stream C can reuse it for structured workflow streams.
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
  /** Max reconnect attempts on transient network drops. Default 3. */
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

  function emitEvent(eventBlock: string) {
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

  async function consume(
    url: string,
    init: { body?: unknown; headers?: Record<string, string> } | undefined,
    retryCount: number,
  ): Promise<void> {
    abortController = new AbortController()
    status.value = retryCount === 0 ? 'connecting' : 'reconnecting'

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(init?.headers ?? {}),
        },
        body: JSON.stringify(init?.body ?? {}),
        signal: abortController.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      return scheduleRetry(url, init, retryCount, err as Error)
    }

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '')
      const message =
        `SSE request failed: ${response.status} ${response.statusText}` +
        (body ? ` — ${body.slice(0, 200)}` : '')
      status.value = 'error'
      options.onError?.(new Error(message))
      return
    }

    status.value = 'streaming'
    const reader = response.body.getReader()
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
      return scheduleRetry(url, init, retryCount, err as Error)
    }
  }

  async function scheduleRetry(
    url: string,
    init: { body?: unknown; headers?: Record<string, string> } | undefined,
    retryCount: number,
    err: Error,
  ): Promise<void> {
    if (retryCount >= maxRetries) {
      status.value = 'error'
      options.onError?.(err)
      return
    }
    const delay = retryBaseMs * 2 ** retryCount
    status.value = 'reconnecting'
    await new Promise((r) => setTimeout(r, delay))
    return consume(url, init, retryCount + 1)
  }

  async function start(
    url: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<void> {
    return consume(url, init, 0)
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
