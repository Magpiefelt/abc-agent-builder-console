/**
 * Free Agent session store.
 *
 * Holds the live state for one session: status machine, iteration log,
 * blackboard/scratchpad/attributes (mirrored from the backend), artifacts,
 * tool-call history, errors, final report. Wires the SSE stream from
 * /api/agent/sessions/:id/start into one mutation per event type.
 *
 * The orchestrator's blackboard_update / scratchpad_update / attributes_update
 * events carry counts only — full payloads are fetched via a debounced GET
 * /sessions/:id so a burst of memory events in one iteration triggers a
 * single reconcile instead of three parallel requests.
 */

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useSSEStream } from '@/composables/useSSEStream'
import { useToast } from '@/composables/useToast'
import { apiFetch, type ApiError } from '@/composables/useApiFetch'

export type SessionStatus =
  | 'idle'
  | 'creating'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error'
  | 'needs_assistance'

export interface BlackboardEntry {
  category: string
  title: string
  content: string
  iteration: number
}

export interface ArtifactRecord {
  id: string | null
  title: string
  type: string
  mimeType: string | null
  description: string | null
  iteration: number
  size: number
}

export interface ToolCallLogEntry {
  iteration: number
  tool: string
  success: boolean
  durationMs: number
  error?: string
}

export interface IterationRecord {
  iteration: number
  status: 'pending' | 'running' | 'completed' | 'error'
  thinking?: string
  userMessage?: string | null
  toolCallCount?: number
  tokensUsed?: number
  toolCalls: Array<{ tool: string }>
  toolResults: Array<{
    tool: string
    success: boolean
    durationMs: number
    error?: string
  }>
  durationMs?: number
  parsedStatus?: string
  error?: string
}

export interface CreateSessionPayload {
  prompt: string
  modelId: string
  classification: string
  maxIterations: number
}

export interface PromptSectionOverride {
  enabled?: boolean
  content?: string
}

interface SSEEvent {
  type: string
  [k: string]: unknown
}

const MAX_ERRORS_RETAINED = 20
const MEMORY_REFRESH_DEBOUNCE_MS = 150

const VALID_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'idle',
  'creating',
  'running',
  'paused',
  'completed',
  'error',
  'needs_assistance',
])

function isValidStatus(s: string): s is SessionStatus {
  return VALID_STATUSES.has(s as SessionStatus)
}

export const useAgentSessionStore = defineStore('agentSession', () => {
  const toast = useToast()

  const status = ref<SessionStatus>('idle')
  const sessionId = ref<string | null>(null)
  const sessionMeta = ref<{
    prompt: string
    modelId: string
    classification: string
    maxIterations: number
  } | null>(null)
  const currentIteration = ref(0)
  const iterations = ref<IterationRecord[]>([])
  const blackboard = ref<BlackboardEntry[]>([])
  const scratchpad = ref<string>('')
  const attributes = ref<Record<string, unknown>>({})
  const artifacts = ref<ArtifactRecord[]>([])
  const toolCallLog = ref<ToolCallLogEntry[]>([])
  const errors = ref<string[]>([])
  const finalReport = ref<unknown>(null)
  const streamStatus = ref<string>('idle')

  const isRunning = computed(() => status.value === 'running')
  const canStop = computed(() => status.value === 'running')
  const canContinue = computed(
    () =>
      status.value === 'paused' ||
      status.value === 'completed' ||
      status.value === 'needs_assistance',
  )
  const canInterject = computed(() => status.value === 'running')

  // Lookup index so per-event mutations are O(1) instead of O(n).
  const iterationIndex = new Map<number, IterationRecord>()
  let activeStream: ReturnType<typeof useSSEStream<SSEEvent>> | null = null
  let stopStatusWatcher: (() => void) | null = null
  let memoryRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let memoryRefreshInFlight = false

  function reset(): void {
    status.value = 'idle'
    sessionId.value = null
    sessionMeta.value = null
    currentIteration.value = 0
    iterations.value = []
    iterationIndex.clear()
    blackboard.value = []
    scratchpad.value = ''
    attributes.value = {}
    artifacts.value = []
    toolCallLog.value = []
    errors.value = []
    finalReport.value = null
    streamStatus.value = 'idle'
    stopStatusWatcher?.()
    stopStatusWatcher = null
    activeStream?.abort()
    activeStream = null
    if (memoryRefreshTimer) {
      clearTimeout(memoryRefreshTimer)
      memoryRefreshTimer = null
    }
  }

  function pushError(message: string): void {
    const next = [...errors.value, message]
    errors.value =
      next.length > MAX_ERRORS_RETAINED ? next.slice(next.length - MAX_ERRORS_RETAINED) : next
  }

  function ensureIteration(n: number): IterationRecord {
    let rec = iterationIndex.get(n)
    if (!rec) {
      rec = { iteration: n, status: 'running', toolCalls: [], toolResults: [] }
      iterationIndex.set(n, rec)
      iterations.value = [...iterations.value, rec]
    }
    return rec
  }

  function patchIteration(n: number, patch: Partial<IterationRecord>): void {
    const rec = iterationIndex.get(n)
    if (!rec) return
    Object.assign(rec, patch)
    // Replace the array reference so reactive consumers re-render.
    iterations.value = [...iterations.value]
  }

  function scheduleMemoryRefresh(): void {
    if (memoryRefreshTimer) clearTimeout(memoryRefreshTimer)
    memoryRefreshTimer = setTimeout(() => {
      memoryRefreshTimer = null
      void refreshSessionMemory()
    }, MEMORY_REFRESH_DEBOUNCE_MS)
  }

  async function refreshSessionMemory(): Promise<void> {
    if (!sessionId.value || memoryRefreshInFlight) return
    memoryRefreshInFlight = true
    try {
      const data = await apiFetch<{
        blackboard?: BlackboardEntry[]
        scratchpad?: string
        attributes?: Record<string, unknown>
        finalReport?: unknown
        status?: SessionStatus
      }>(`/api/agent/sessions/${sessionId.value}`)
      if (Array.isArray(data.blackboard)) blackboard.value = data.blackboard
      if (typeof data.scratchpad === 'string') scratchpad.value = data.scratchpad
      if (data.attributes && typeof data.attributes === 'object') {
        attributes.value = data.attributes as Record<string, unknown>
      }
      if (data.finalReport !== undefined && data.finalReport !== null) {
        finalReport.value = data.finalReport
      }
    } catch {
      // transient — next event will retrigger a refresh
    } finally {
      memoryRefreshInFlight = false
    }
  }

  /** After a transport-level stream error, reconcile our local status to whatever the backend says. */
  async function reconcileAfterStreamError(): Promise<void> {
    if (!sessionId.value) return
    try {
      const data = await apiFetch<{ status?: SessionStatus; isRunning?: boolean }>(
        `/api/agent/sessions/${sessionId.value}`,
      )
      if (data.status) status.value = data.status
    } catch {
      // Ignore — UI keeps its current status until the user acts.
    }
  }

  function handleEvent(event: SSEEvent): void {
    // After reset() the active stream is aborted but in-flight events may
    // still land before the AbortError propagates. Drop them so they don't
    // dirty the cleared state.
    if (!sessionId.value) return
    switch (event.type) {
      case 'session_start': {
        status.value = 'running'
        if (typeof event.modelId === 'string' && sessionMeta.value) {
          sessionMeta.value = { ...sessionMeta.value, modelId: event.modelId }
        }
        break
      }
      case 'iteration_start': {
        const n = Number(event.iteration) || 0
        currentIteration.value = n
        ensureIteration(n)
        break
      }
      case 'llm_response': {
        const n = Number(event.iteration) || currentIteration.value
        ensureIteration(n)
        patchIteration(n, {
          thinking: typeof event.thinking === 'string' ? event.thinking : undefined,
          parsedStatus: typeof event.status === 'string' ? event.status : undefined,
          userMessage: (event.userMessage as string | null | undefined) ?? null,
          toolCallCount: typeof event.toolCallCount === 'number' ? event.toolCallCount : undefined,
          tokensUsed: typeof event.tokensUsed === 'number' ? event.tokensUsed : undefined,
        })
        break
      }
      case 'tool_calls': {
        const n = Number(event.iteration) || currentIteration.value
        const calls = (event.calls as Array<{ tool: string }>) ?? []
        const rec = ensureIteration(n)
        rec.toolCalls = [...rec.toolCalls, ...calls]
        patchIteration(n, {})
        break
      }
      case 'tool_result': {
        const n = Number(event.iteration) || currentIteration.value
        const tool = String(event.tool ?? '')
        const success = !!event.success
        const durationMs = Number(event.durationMs) || 0
        const error = typeof event.error === 'string' ? event.error : undefined
        const rec = ensureIteration(n)
        rec.toolResults = [...rec.toolResults, { tool, success, durationMs, error }]
        patchIteration(n, {})
        toolCallLog.value = [...toolCallLog.value, { iteration: n, tool, success, durationMs, error }]
        break
      }
      case 'blackboard_update':
      case 'scratchpad_update':
      case 'attributes_update': {
        scheduleMemoryRefresh()
        break
      }
      case 'artifact_created': {
        const a = event.artifact as Partial<ArtifactRecord> | undefined
        if (!a) break
        const iteration = Number(event.iteration) || currentIteration.value
        artifacts.value = [
          ...artifacts.value,
          {
            id: a.id ?? null,
            title: a.title ?? 'Untitled',
            type: a.type ?? 'text',
            mimeType: a.mimeType ?? null,
            description: a.description ?? null,
            iteration,
            size: a.size ?? 0,
          },
        ]
        break
      }
      case 'iteration_complete': {
        const n = Number(event.iteration) || currentIteration.value
        patchIteration(n, {
          status: 'completed',
          durationMs: typeof event.durationMs === 'number' ? event.durationMs : undefined,
          tokensUsed: typeof event.tokensUsed === 'number' ? event.tokensUsed : undefined,
          userMessage: (event.userMessage as string | null | undefined) ?? null,
        })
        break
      }
      case 'loop_warning': {
        toast.push({
          kind: 'warning',
          message: `Loop warning (${event.level ?? 'L?'}): ${event.description ?? 'Possible loop detected.'}`,
        })
        break
      }
      case 'loop_intervention': {
        status.value = 'needs_assistance'
        toast.push({
          kind: 'warning',
          message: typeof event.message === 'string' ? event.message : 'Loop intervention triggered.',
          ttlMs: 8000,
        })
        break
      }
      case 'pii_warning': {
        toast.push({
          kind: 'warning',
          message: typeof event.message === 'string' ? event.message : 'PII detected and redacted.',
        })
        break
      }
      case 'llm_error': {
        const msg = typeof event.error === 'string' ? event.error : 'LLM error'
        const iter = Number(event.iteration) || currentIteration.value
        pushError(msg)
        if (iterationIndex.has(iter)) patchIteration(iter, { status: 'error', error: msg })
        toast.push({ kind: 'error', message: `LLM error: ${msg}` })
        break
      }
      case 'iteration_limit': {
        status.value = 'completed'
        toast.push({
          kind: 'info',
          message: typeof event.message === 'string' ? event.message : 'Iteration limit reached.',
        })
        break
      }
      case 'session_stopped': {
        status.value = 'paused'
        break
      }
      case 'session_complete': {
        // Respect the backend's final word — it could be completed, paused
        // (after stop), error, or needs_assistance.
        const finalStatus =
          typeof event.status === 'string' && isValidStatus(event.status)
            ? (event.status as SessionStatus)
            : 'completed'
        status.value = finalStatus
        if (event.finalReport !== undefined && event.finalReport !== null) {
          finalReport.value = event.finalReport
        }
        if (typeof event.error === 'string' && event.error) {
          pushError(event.error)
        }
        scheduleMemoryRefresh()
        break
      }
      case 'error': {
        const msg = typeof event.error === 'string' ? event.error : 'Session error'
        status.value = 'error'
        pushError(msg)
        toast.push({ kind: 'error', message: msg, ttlMs: 8000 })
        break
      }
      default:
        // Forward-compatible: ignore unknown event types.
        break
    }
  }

  function attachStream(stream: ReturnType<typeof useSSEStream<SSEEvent>>): void {
    stopStatusWatcher?.()
    stopStatusWatcher = watch(
      stream.status,
      (v) => {
        streamStatus.value = v
      },
      { immediate: true },
    )
  }

  async function createSession(payload: CreateSessionPayload): Promise<string> {
    reset()
    status.value = 'creating'
    sessionMeta.value = {
      prompt: payload.prompt,
      modelId: payload.modelId,
      classification: payload.classification,
      maxIterations: payload.maxIterations,
    }
    try {
      const data = await apiFetch<{ id: string }>('/api/agent/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      sessionId.value = data.id
      return data.id
    } catch (err) {
      status.value = 'error'
      const msg = (err as ApiError).message || 'Failed to create session.'
      pushError(msg)
      toast.push({ kind: 'error', message: msg })
      throw err
    }
  }

  async function startStream(opts?: {
    sectionOverrides?: Record<string, PromptSectionOverride>
    enabledTools?: string[]
  }): Promise<void> {
    if (!sessionId.value) throw new Error('No session to start')
    activeStream?.abort()
    activeStream = useSSEStream<SSEEvent>({
      onEvent: handleEvent,
      onError: (err) => {
        pushError(err.message || 'Stream error')
        toast.push({ kind: 'error', message: err.message || 'Stream error' })
        void reconcileAfterStreamError()
      },
      onDone: () => {
        // Final reconcile in case the last memory event raced ahead of the GET.
        scheduleMemoryRefresh()
      },
    })
    attachStream(activeStream)
    void activeStream.start(`/api/agent/sessions/${sessionId.value}/start`, {
      body: {
        sectionOverrides: opts?.sectionOverrides,
        enabledTools: opts?.enabledTools,
      },
    })
  }

  async function stop(): Promise<void> {
    if (!sessionId.value) return
    // We deliberately do NOT abort the stream or optimistically change
    // status. The /stop endpoint just sets a flag; the orchestrator emits
    // session_stopped + session_complete, and our event handlers settle on
    // the authoritative final status. Aborting the stream early would race
    // with the backend's session-lifecycle cleanup.
    try {
      await apiFetch(`/api/agent/sessions/${sessionId.value}/stop`, { method: 'POST' })
      toast.push({ kind: 'info', message: 'Stop signal sent. Halting after this iteration.' })
    } catch (err) {
      toast.push({ kind: 'error', message: (err as Error).message || 'Failed to stop session.' })
    }
  }

  async function continueSession(prompt: string, additionalIterations?: number): Promise<void> {
    if (!sessionId.value) throw new Error('No session to continue')
    if (!prompt.trim()) return
    activeStream?.abort()
    activeStream = useSSEStream<SSEEvent>({
      onEvent: handleEvent,
      onError: (err) => {
        pushError(err.message || 'Stream error')
        toast.push({ kind: 'error', message: err.message || 'Stream error' })
        void reconcileAfterStreamError()
      },
      onDone: () => scheduleMemoryRefresh(),
    })
    attachStream(activeStream)
    status.value = 'running'
    void activeStream.start(`/api/agent/sessions/${sessionId.value}/continue`, {
      body: { prompt, additionalIterations },
    })
  }

  async function interject(message: string): Promise<void> {
    if (!sessionId.value || !message.trim()) return
    try {
      await apiFetch(`/api/agent/sessions/${sessionId.value}/interject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      toast.push({ kind: 'info', message: 'Interjection queued for the next iteration.' })
    } catch (err) {
      toast.push({ kind: 'error', message: (err as Error).message || 'Failed to send interjection.' })
    }
  }

  return {
    status,
    sessionId,
    sessionMeta,
    currentIteration,
    iterations,
    blackboard,
    scratchpad,
    attributes,
    artifacts,
    toolCallLog,
    errors,
    finalReport,
    streamStatus,
    isRunning,
    canStop,
    canContinue,
    canInterject,
    reset,
    createSession,
    startStream,
    stop,
    continueSession,
    interject,
    refreshSessionMemory,
  }
})
