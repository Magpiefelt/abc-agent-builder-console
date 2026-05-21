/**
 * Unit tests for the agentSession Pinia store.
 *
 * Tests are written against the `handleSseEvent` hook (exposed in the store
 * return value for testability) so each SSE event type can be exercised
 * without a live network connection. Network-bound actions (createSession,
 * startStream, stop, interject) are covered by the evals integration suite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAgentSessionStore } from '../agentSession'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a session ID so that handleSseEvent does not early-return. */
function seedSession(store: ReturnType<typeof useAgentSessionStore>, id = 'test-session-123'): void {
  // Access the underlying ref via $patch so we bypass the "no sessionId → drop event" guard.
  store.$patch({ sessionId: id } as Parameters<typeof store.$patch>[0])
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setActivePinia(createPinia())
  // Silence toast calls (useToast writes to a shared store that is not set up
  // in jsdom test runs).
  vi.stubGlobal('fetch', vi.fn())
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentSessionStore — initial state', () => {
  it('starts in idle state with empty memory', () => {
    const store = useAgentSessionStore()
    expect(store.status).toBe('idle')
    expect(store.sessionId).toBeNull()
    expect(store.iterations).toHaveLength(0)
    expect(store.blackboard).toHaveLength(0)
    expect(store.scratchpad).toBe('')
    expect(store.attributes).toEqual({})
    expect(store.artifacts).toHaveLength(0)
    expect(store.errors).toHaveLength(0)
    expect(store.finalReport).toBeNull()
  })
})

describe('useAgentSessionStore — session_start event', () => {
  it('sets status to running', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'session_start', modelId: 'claude-sonnet-4-6' })
    expect(store.status).toBe('running')
  })

  it('updates sessionMeta.modelId when present', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.$patch({ sessionMeta: { prompt: 'p', modelId: 'old', classification: 'unclassified', maxIterations: 5 } } as Parameters<typeof store.$patch>[0])
    store.handleSseEvent({ type: 'session_start', modelId: 'claude-haiku-4-5' })
    expect(store.sessionMeta?.modelId).toBe('claude-haiku-4-5')
  })
})

describe('useAgentSessionStore — iteration_start event', () => {
  it('increments the currentIteration counter', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    expect(store.currentIteration).toBe(1)
  })

  it('creates an IterationRecord for the given iteration number', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 3 })
    const rec = store.iterations.find((i) => i.iteration === 3)
    expect(rec).toBeDefined()
    expect(rec?.status).toBe('running')
  })
})

describe('useAgentSessionStore — llm_response event', () => {
  it('stores latest thinking + token usage on the iteration record', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    store.handleSseEvent({
      type: 'llm_response',
      iteration: 1,
      thinking: 'Let me think…',
      tokensUsed: 512,
      toolCallCount: 2,
      status: 'running',
    })
    const rec = store.iterations[0]
    expect(rec.thinking).toBe('Let me think…')
    expect(rec.tokensUsed).toBe(512)
    expect(rec.toolCallCount).toBe(2)
    expect(rec.parsedStatus).toBe('running')
  })
})

describe('useAgentSessionStore — blackboard_update / scratchpad_update / attributes_update', () => {
  it('triggers a memory refresh (does not mutate store synchronously)', () => {
    // These events schedule a debounced GET /sessions/:id rather than updating
    // the store directly. We just confirm the event handler does not crash.
    const store = useAgentSessionStore()
    seedSession(store)
    expect(() => {
      store.handleSseEvent({ type: 'blackboard_update' })
      store.handleSseEvent({ type: 'scratchpad_update' })
      store.handleSseEvent({ type: 'attributes_update' })
    }).not.toThrow()
  })
})

describe('useAgentSessionStore — tool_calls event', () => {
  it('appends tool calls to the matching iteration', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    store.handleSseEvent({
      type: 'tool_calls',
      iteration: 1,
      calls: [{ tool: 'brave_search' }, { tool: 'web_scrape' }],
    })
    const rec = store.iterations[0]
    expect(rec.toolCalls).toHaveLength(2)
    expect(rec.toolCalls[0].tool).toBe('brave_search')
    expect(rec.toolCalls[1].tool).toBe('web_scrape')
  })
})

describe('useAgentSessionStore — tool_result event', () => {
  it('appends a tool result and adds to toolCallLog', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    store.handleSseEvent({
      type: 'tool_result',
      iteration: 1,
      tool: 'brave_search',
      success: true,
      durationMs: 340,
    })
    const rec = store.iterations[0]
    expect(rec.toolResults).toHaveLength(1)
    expect(rec.toolResults[0].tool).toBe('brave_search')
    expect(rec.toolResults[0].success).toBe(true)
    expect(store.toolCallLog).toHaveLength(1)
    expect(store.toolCallLog[0].tool).toBe('brave_search')
  })

  it('captures the error field on a failed tool result', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    store.handleSseEvent({
      type: 'tool_result',
      iteration: 1,
      tool: 'web_scrape',
      success: false,
      durationMs: 50,
      error: 'SSRF blocked',
    })
    expect(store.toolCallLog[0].error).toBe('SSRF blocked')
    expect(store.toolCallLog[0].success).toBe(false)
  })
})

describe('useAgentSessionStore — session_complete event', () => {
  it('sets terminal status = completed and stores finalReport', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'session_start' })
    store.handleSseEvent({
      type: 'session_complete',
      status: 'completed',
      finalReport: { summary: 'done' },
    })
    expect(store.status).toBe('completed')
    expect(store.finalReport).toEqual({ summary: 'done' })
  })

  it('defaults to completed status when none is provided', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'session_complete' })
    expect(store.status).toBe('completed')
  })

  it('surfaces an error string from the session_complete payload', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'session_complete', status: 'error', error: 'orchestrator failed' })
    expect(store.errors).toContain('orchestrator failed')
  })
})

describe('useAgentSessionStore — error event', () => {
  it('surfaces error message in store.errors and sets status=error', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'error', error: 'fatal error from backend' })
    expect(store.status).toBe('error')
    expect(store.errors).toContain('fatal error from backend')
  })
})

describe('useAgentSessionStore — reset()', () => {
  it('clears all session state back to idle', () => {
    const store = useAgentSessionStore()
    seedSession(store, 'to-be-cleared')
    store.handleSseEvent({ type: 'session_start' })
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    store.reset()
    expect(store.status).toBe('idle')
    expect(store.sessionId).toBeNull()
    expect(store.currentIteration).toBe(0)
    expect(store.iterations).toHaveLength(0)
    expect(store.errors).toHaveLength(0)
    expect(store.finalReport).toBeNull()
  })
})

describe('useAgentSessionStore — idempotent SSE replay', () => {
  it('applying iteration_start twice does not double-add to iterations', () => {
    const store = useAgentSessionStore()
    seedSession(store)
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    store.handleSseEvent({ type: 'iteration_start', iteration: 1 })
    expect(store.iterations.filter((i) => i.iteration === 1)).toHaveLength(1)
  })
})
