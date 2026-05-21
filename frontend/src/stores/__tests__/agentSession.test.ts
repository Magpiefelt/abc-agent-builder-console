/**
 * agentSession store — SSE event reducer contract.
 *
 * Drives the store directly through createSession() + the private handleEvent
 * exposed via the underlying SSE composable mock. The composable mock captures
 * the onEvent callback so we can feed it deterministic event sequences without
 * a real backend.
 *
 * Memory events (blackboard/scratchpad/attributes) are debounced into a single
 * GET /sessions/:id — apiFetch is mocked so we can both assert the debounce
 * and seed the canonical memory payload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick, type Ref } from 'vue'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useApiFetch', () => ({
  apiFetch: apiFetchMock,
}))

interface CapturedStream {
  onEvent: (event: Record<string, unknown>) => void
  onError?: (err: Error) => void
  onDone?: () => void
  start: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  status: Ref<string>
}

const streams = vi.hoisted<{ list: CapturedStream[] }>(() => ({ list: [] }))

vi.mock('@/composables/useSSEStream', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useSSEStream: (opts: {
      onEvent: (event: Record<string, unknown>) => void
      onError?: (err: Error) => void
      onDone?: () => void
    }) => {
      const stream: CapturedStream = {
        onEvent: opts.onEvent,
        onError: opts.onError,
        onDone: opts.onDone,
        start: vi.fn(),
        abort: vi.fn(),
        status: vueRef('idle'),
      }
      streams.list.push(stream)
      return stream
    },
  }
})

// Toast push is invoked by several handlers; route to a vi.fn so we can
// assert side effects without rendering ToastContainer.
const toastPushMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    toasts: { value: [] },
    push: toastPushMock,
    dismiss: vi.fn(),
  }),
}))

import { useAgentSessionStore } from '@/stores/agentSession'

const SESSION_ID = 'sess-123'
const BASE_PAYLOAD = {
  prompt: 'Investigate X',
  modelId: 'claude-sonnet-4-6',
  classification: 'unclassified',
  maxIterations: 20,
}

async function startSession(): Promise<ReturnType<typeof useAgentSessionStore>> {
  const store = useAgentSessionStore()
  apiFetchMock.mockResolvedValueOnce({ id: SESSION_ID })
  await store.createSession(BASE_PAYLOAD)
  // startStream() attaches the SSE stream that captures handleEvent.
  await store.startStream()
  return store
}

function lastStream(): CapturedStream {
  const s = streams.list[streams.list.length - 1]
  if (!s) throw new Error('No SSE stream captured')
  return s
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetchMock.mockReset()
  toastPushMock.mockReset()
  streams.list.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgentSessionStore — initial state', () => {
  it('starts in idle state with empty memory', () => {
    const store = useAgentSessionStore()
    expect(store.status).toBe('idle')
    expect(store.sessionId).toBe(null)
    expect(store.currentIteration).toBe(0)
    expect(store.iterations).toEqual([])
    expect(store.blackboard).toEqual([])
    expect(store.scratchpad).toBe('')
    expect(store.attributes).toEqual({})
    expect(store.artifacts).toEqual([])
    expect(store.toolCallLog).toEqual([])
    expect(store.errors).toEqual([])
    expect(store.finalReport).toBe(null)
  })
})

describe('useAgentSessionStore — SSE event reducer', () => {
  it('session_start: sets sessionId and status=running', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'session_start', modelId: 'claude-opus-4-7' })
    expect(store.status).toBe('running')
    expect(store.sessionId).toBe(SESSION_ID)
    expect(store.sessionMeta?.modelId).toBe('claude-opus-4-7')
  })

  it('iteration_start: increments iteration counter', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'iteration_start', iteration: 1 })
    expect(store.currentIteration).toBe(1)
    expect(store.iterations).toHaveLength(1)
    expect(store.iterations[0]).toMatchObject({ iteration: 1, status: 'running' })

    lastStream().onEvent({ type: 'iteration_start', iteration: 2 })
    expect(store.currentIteration).toBe(2)
    expect(store.iterations).toHaveLength(2)
  })

  it('llm_response: stores latest thinking + token usage on the iteration record', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'iteration_start', iteration: 1 })
    lastStream().onEvent({
      type: 'llm_response',
      iteration: 1,
      thinking: 'Considering options…',
      status: 'continue',
      userMessage: null,
      toolCallCount: 2,
      tokensUsed: 1234,
    })
    const rec = store.iterations[0]
    expect(rec.thinking).toBe('Considering options…')
    expect(rec.parsedStatus).toBe('continue')
    expect(rec.toolCallCount).toBe(2)
    expect(rec.tokensUsed).toBe(1234)
  })

  it('tool_calls + tool_result: tracks pending and resolved tool calls per iteration', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'iteration_start', iteration: 1 })
    lastStream().onEvent({
      type: 'tool_calls',
      iteration: 1,
      calls: [{ tool: 'web_search' }, { tool: 'github_search' }],
    })
    expect(store.iterations[0].toolCalls).toHaveLength(2)
    expect(store.iterations[0].toolResults).toHaveLength(0)

    lastStream().onEvent({
      type: 'tool_result',
      iteration: 1,
      tool: 'web_search',
      success: true,
      durationMs: 420,
    })
    expect(store.iterations[0].toolResults).toEqual([
      { tool: 'web_search', success: true, durationMs: 420, error: undefined },
    ])
    expect(store.toolCallLog).toHaveLength(1)
    expect(store.toolCallLog[0]).toMatchObject({
      iteration: 1,
      tool: 'web_search',
      success: true,
    })

    lastStream().onEvent({
      type: 'tool_result',
      iteration: 1,
      tool: 'github_search',
      success: false,
      durationMs: 80,
      error: 'rate limited',
    })
    expect(store.iterations[0].toolResults).toHaveLength(2)
    expect(store.toolCallLog[1].error).toBe('rate limited')
    expect(store.toolCallLog[1].success).toBe(false)
  })

  it('memory events trigger a single debounced GET /sessions/:id refresh', async () => {
    const store = await startSession()
    // Forget the createSession POST so the debounce assertion is meaningful.
    apiFetchMock.mockClear()
    apiFetchMock.mockResolvedValueOnce({
      blackboard: [
        { category: 'finding', title: 'A', content: 'a', iteration: 1 },
      ],
      scratchpad: 'partial notes',
      attributes: { confidence: 'high' },
    })

    lastStream().onEvent({ type: 'blackboard_update', count: 1 })
    lastStream().onEvent({ type: 'scratchpad_update' })
    lastStream().onEvent({ type: 'attributes_update' })

    // Memory refresh hasn't fired yet — debounce is 150ms.
    expect(apiFetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    await nextTick()

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock.mock.calls[0][0]).toBe(`/api/agent/sessions/${SESSION_ID}`)
    expect(store.blackboard).toHaveLength(1)
    expect(store.scratchpad).toBe('partial notes')
    expect(store.attributes).toEqual({ confidence: 'high' })
  })

  it('artifact_created: appends a normalized artifact record', async () => {
    const store = await startSession()
    lastStream().onEvent({
      type: 'artifact_created',
      iteration: 2,
      artifact: {
        id: 'art-1',
        title: 'Report.pdf',
        type: 'document',
        mimeType: 'application/pdf',
        description: 'Final report',
        size: 4096,
      },
    })
    expect(store.artifacts).toHaveLength(1)
    expect(store.artifacts[0]).toMatchObject({
      id: 'art-1',
      title: 'Report.pdf',
      type: 'document',
      iteration: 2,
      size: 4096,
    })
  })

  it('iteration_complete: marks the iteration completed with duration + tokens', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'iteration_start', iteration: 1 })
    lastStream().onEvent({
      type: 'iteration_complete',
      iteration: 1,
      durationMs: 1500,
      tokensUsed: 800,
    })
    expect(store.iterations[0]).toMatchObject({
      status: 'completed',
      durationMs: 1500,
      tokensUsed: 800,
    })
  })

  it('loop_intervention: transitions status to needs_assistance + pushes warning toast', async () => {
    const store = await startSession()
    lastStream().onEvent({
      type: 'loop_intervention',
      level: 3,
      message: 'Intervening at level 3',
    })
    expect(store.status).toBe('needs_assistance')
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'warning', message: 'Intervening at level 3' }),
    )
  })

  it('llm_error: pushes error, surfaces a toast, and marks the iteration errored', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'iteration_start', iteration: 3 })
    lastStream().onEvent({
      type: 'llm_error',
      iteration: 3,
      error: 'rate_limit_exceeded',
    })
    expect(store.errors).toContain('rate_limit_exceeded')
    expect(store.iterations[0]).toMatchObject({ status: 'error', error: 'rate_limit_exceeded' })
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    )
  })

  it('session_complete: respects backend final status + final report', async () => {
    const store = await startSession()
    apiFetchMock.mockResolvedValueOnce({}) // swallow the trailing memory refresh
    lastStream().onEvent({
      type: 'session_complete',
      status: 'completed',
      finalReport: { summary: 'done' },
    })
    expect(store.status).toBe('completed')
    expect(store.finalReport).toEqual({ summary: 'done' })
  })

  it('session_complete with status="error" surfaces the error string', async () => {
    const store = await startSession()
    apiFetchMock.mockResolvedValueOnce({})
    lastStream().onEvent({
      type: 'session_complete',
      status: 'error',
      error: 'orchestrator crashed',
    })
    expect(store.status).toBe('error')
    expect(store.errors).toContain('orchestrator crashed')
  })

  it('error event: surfaces error message and sets terminal error status', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'error', error: 'boom' })
    expect(store.status).toBe('error')
    expect(store.errors).toContain('boom')
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', message: 'boom' }),
    )
  })

  it('reset(): clears all session state back to idle and aborts the active stream', async () => {
    const store = await startSession()
    lastStream().onEvent({ type: 'iteration_start', iteration: 1 })
    lastStream().onEvent({
      type: 'tool_result',
      iteration: 1,
      tool: 'web_search',
      success: true,
      durationMs: 10,
    })
    const captured = lastStream()
    store.reset()
    expect(store.status).toBe('idle')
    expect(store.sessionId).toBe(null)
    expect(store.currentIteration).toBe(0)
    expect(store.iterations).toEqual([])
    expect(store.toolCallLog).toEqual([])
    expect(captured.abort).toHaveBeenCalled()
  })

  it('events arriving after reset() are ignored', async () => {
    const store = await startSession()
    const captured = lastStream()
    store.reset()
    captured.onEvent({ type: 'iteration_start', iteration: 1 })
    captured.onEvent({
      type: 'tool_result',
      iteration: 1,
      tool: 'web_search',
      success: true,
      durationMs: 10,
    })
    expect(store.iterations).toEqual([])
    expect(store.toolCallLog).toEqual([])
  })

  it('unknown event types are ignored without throwing', async () => {
    const store = await startSession()
    expect(() =>
      lastStream().onEvent({ type: 'mystery_event', payload: 'whatever' }),
    ).not.toThrow()
    expect(store.errors).toEqual([])
  })
})
