/**
 * Unit tests for the useSSEStream composable.
 *
 * We mock `fetch` to return a synthetic ReadableStream carrying SSE bytes,
 * letting us verify the full parse / dispatch / status-machine pipeline
 * without a live server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSSEStream } from '../useSSEStream'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock ReadableStream that yields the provided SSE lines as UTF-8
 * chunks, then closes.
 */
function sseStream(...lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = lines.map((l) => encoder.encode(l))
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
      } else {
        controller.close()
      }
    },
  })
}

/** Create a successful mock Response with a ReadableStream body. */
function makeOkResponse(body: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body,
  } as unknown as Response
}

/** Create a failing mock Response. */
function makeErrorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    body: null,
    text: () => Promise.resolve(`${status} error`),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSSEStream — initial state', () => {
  it('starts in idle status', () => {
    const stream = useSSEStream({ onEvent: vi.fn() })
    expect(stream.status.value).toBe('idle')
  })
})

describe('useSSEStream — abort()', () => {
  it('sets status back to idle when called before streaming starts', () => {
    const stream = useSSEStream({ onEvent: vi.fn() })
    stream.abort()
    expect(stream.status.value).toBe('idle')
  })
})

describe('useSSEStream — SSE event parsing', () => {
  it('dispatches a parsed JSON event to onEvent', async () => {
    const onEvent = vi.fn()
    // A single SSE event block: "data: ...\n\n"
    const body = sseStream('data: {"type":"session_start"}\n\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse(body)))

    const stream = useSSEStream({ onEvent })
    await stream.start('/api/fake/stream', {})

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith({ type: 'session_start' })
    expect(stream.status.value).toBe('done')
  })

  it('dispatches multiple events from a single stream', async () => {
    const events: unknown[] = []
    const body = sseStream(
      'data: {"type":"session_start"}\n\n',
      'data: {"type":"iteration_start","iteration":1}\n\n',
      'data: {"type":"session_complete"}\n\n',
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse(body)))

    const stream = useSSEStream({ onEvent: (e) => events.push(e) })
    await stream.start('/api/fake/stream', {})

    expect(events).toHaveLength(3)
    expect((events[0] as Record<string, unknown>).type).toBe('session_start')
    expect((events[2] as Record<string, unknown>).type).toBe('session_complete')
  })

  it('skips comment lines (lines starting with :)', async () => {
    const onEvent = vi.fn()
    const body = sseStream(': heartbeat\n\ndata: {"type":"ping"}\n\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse(body)))

    const stream = useSSEStream({ onEvent })
    await stream.start('/api/fake/stream', {})

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith({ type: 'ping' })
  })

  it('calls onError when event JSON is malformed', async () => {
    const onError = vi.fn()
    const body = sseStream('data: {not valid json}\n\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse(body)))

    const stream = useSSEStream({ onEvent: vi.fn(), onError })
    await stream.start('/api/fake/stream', {})

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('calls onDone when the stream closes normally', async () => {
    const onDone = vi.fn()
    const body = sseStream('data: {"type":"session_complete"}\n\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse(body)))

    const stream = useSSEStream({ onEvent: vi.fn(), onDone })
    await stream.start('/api/fake/stream', {})

    expect(onDone).toHaveBeenCalledOnce()
  })
})

describe('useSSEStream — HTTP error handling', () => {
  it('sets status to error and calls onError when the server returns 4xx', async () => {
    const onError = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrorResponse(401, 'Unauthorized')))

    const stream = useSSEStream({ onEvent: vi.fn(), onError })
    await stream.start('/api/fake/stream', {})

    expect(stream.status.value).toBe('error')
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].message).toMatch(/401/)
  })

  it('sets status to error when fetch throws a network error (after retries exhausted)', async () => {
    const onError = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    // maxRetries=0 to keep the test fast (no backoff delays).
    const stream = useSSEStream({ onEvent: vi.fn(), onError, maxRetries: 0, retryBaseMs: 0 })
    await stream.start('/api/fake/stream', {})

    expect(stream.status.value).toBe('error')
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].message).toMatch(/ECONNREFUSED/)
  })
})
