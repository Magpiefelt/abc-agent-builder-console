/**
 * Free Agent session store.
 *
 * Holds the live state for one session: status machine, iteration log,
 * blackboard/scratchpad/attributes (mirrored from the backend), artifacts,
 * tool-call history, errors, final report. Wires the SSE stream from
 * /api/agent/sessions/:id/start into one mutation per event type.
 *
 * The orchestrator's blackboard_update / scratchpad_update / attributes_update
 * events carry counts only — full payloads are fetched via GET /sessions/:id
 * to keep the SSE contract narrow.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSSEStream } from '@/composables/useSSEStream'
import { useToast } from '@/composables/useToast'

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
    () => status.value === 'paused' || status.value === 'completed' || status.value === 'needs_assistance',
  )
  const canInterject = computed(() => status.value === 'running')

  function reset(): void {
    status.value = 'idle'
    sessionId.value = null
    sessionMeta.value = null
    currentIteration.value = 0
    iterations.value = []
    blackboard.value = []
    scratchpad.value = ''
    attributes.value = {}
    artifacts.value = []
    toolCallLog.value = []
    errors.value = []
    finalReport.value = null
    streamStatus.value = 'idle'
  }

  function ensureIteration(n: number): IterationRecord {
    let rec = iterations.value.find((i) => i.iteration === n)
    if (!rec) {
      rec = {
        iteration: n,
        status: 'running',
        toolCalls: [],
        toolResults: [],
      }
      iterations.value = [...iterations.value, rec]
    }
    return rec
  }

  function replaceIteration(n: number, patch: Partial<IterationRecord>): void {
    iterations.value = iterations.value.map((i) =>
      i.iteration === n ? { ...i, ...patch } : i,
    )
  }

  async function refreshSessionMemory(): Promise<void> {
    if (!sessionId.value) return
    try {
      const res = await fetch(`/api/agent/sessions/${sessionId.value}`)
      if (!res.ok) return
      const data = (await res.json()) as {
        blackboard?: BlackboardEntry[]
        scratchpad?: string
        attributes?: Record<string, unknown>
        finalReport?: unknown
      }
      if (Array.isArray(data.blackboard)) blackboard.value = data.blackboard
      if (typeof data.scratchpad === 'string') scratchpad.value = data.scratchpad
      if (data.attributes && typeof data.attributes === 'object') {
        attributes.value = data.attributes as Record<string, unknown>
      }
      if (data.finalReport !== undefined && data.finalReport !== null) {
        finalReport.value = data.finalReport
      }
    } catch {
      // transient — next event will trigger another refresh
    }
  }

  function handleEvent(event: SSEEvent): void {
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
        replaceIteration(n, {
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
        replaceIteration(n, { toolCalls: [...rec.toolCalls, ...calls] })
        break
      }
      case 'tool_result': {
        const n = Number(event.iteration) || currentIteration.value
        const tool = String(event.tool ?? '')
        const success = !!event.success
        const durationMs = Number(event.durationMs) || 0
        const error = typeof event.error === 'string' ? event.error : undefined
        const rec = ensureIteration(n)
        replaceIteration(n, {
          toolResults: [...rec.toolResults, { tool, success, durationMs, error }],
        })
        toolCallLog.value = [
          ...toolCallLog.value,
          { iteration: n, tool, success, durationMs, error },
        ]
        break
      }
      case 'blackboard_update':
      case 'scratchpad_update':
      case 'attributes_update': {
        void refreshSessionMemory()
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
        replaceIteration(n, {
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
        errors.value = [...errors.value, msg]
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
        status.value = 'completed'
        if (event.finalReport !== undefined && event.finalReport !== null) {
          finalReport.value = event.finalReport
        } else {
          void refreshSessionMemory()
        }
        break
      }
      case 'error': {
        const msg = typeof event.error === 'string' ? event.error : 'Session error'
        status.value = 'error'
        errors.value = [...errors.value, msg]
        toast.push({ kind: 'error', message: msg, ttlMs: 8000 })
        break
      }
      default:
        // Forward-compatible: ignore unknown event types.
        break
    }
  }

  let activeStream: ReturnType<typeof useSSEStream<SSEEvent>> | null = null

  async function createSession(payload: CreateSessionPayload): Promise<string> {
    reset()
    status.value = 'creating'
    sessionMeta.value = {
      prompt: payload.prompt,
      modelId: payload.modelId,
      classification: payload.classification,
      maxIterations: payload.maxIterations,
    }
    const res = await fetch('/api/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      status.value = 'error'
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      const msg = body.error || `Failed to create session (${res.status})`
      errors.value = [...errors.value, msg]
      toast.push({ kind: 'error', message: msg })
      throw new Error(msg)
    }
    const data = (await res.json()) as { id: string }
    sessionId.value = data.id
    return data.id
  }

  async function startStream(opts?: {
    sectionOverrides?: Record<string, PromptSectionOverride>
    enabledTools?: string[]
  }): Promise<void> {
    if (!sessionId.value) throw new Error('No session to start')
    activeStream = useSSEStream<SSEEvent>({
      onEvent: handleEvent,
      onError: (err) => {
        const msg = err.message || 'Stream error'
        errors.value = [...errors.value, msg]
        toast.push({ kind: 'error', message: msg })
        if (status.value === 'running') status.value = 'error'
      },
      onDone: () => {
        // Reconcile final memory in case last event raced ahead of the GET.
        void refreshSessionMemory()
      },
    })
    void activeStream.start(`/api/agent/sessions/${sessionId.value}/start`, {
      body: {
        sectionOverrides: opts?.sectionOverrides,
        enabledTools: opts?.enabledTools,
      },
    })
    // Track stream status (reactive ref) so UI can show "reconnecting" etc.
    const s = activeStream.status
    streamStatus.value = s.value
    // Subscribe via watcher-like effect.
    queueMicrotask(() => {
      const sync = () => (streamStatus.value = s.value)
      const interval = setInterval(sync, 250)
      // Clear when stream resolves to a terminal state.
      const stopWatch = () => {
        if (s.value === 'done' || s.value === 'error' || s.value === 'idle') {
          clearInterval(interval)
        }
      }
      const stopInterval = setInterval(stopWatch, 500)
      // Belt-and-braces cleanup after 10 minutes.
      setTimeout(() => {
        clearInterval(interval)
        clearInterval(stopInterval)
      }, 10 * 60 * 1000)
    })
  }

  async function stop(): Promise<void> {
    if (!sessionId.value) return
    activeStream?.abort()
    const res = await fetch(`/api/agent/sessions/${sessionId.value}/stop`, { method: 'POST' })
    if (res.ok) {
      status.value = 'paused'
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      toast.push({ kind: 'error', message: body.error || 'Failed to stop session.' })
    }
  }

  async function continueSession(prompt: string, additionalIterations?: number): Promise<void> {
    if (!sessionId.value) throw new Error('No session to continue')
    if (!prompt.trim()) return
    activeStream = useSSEStream<SSEEvent>({
      onEvent: handleEvent,
      onError: (err) => {
        toast.push({ kind: 'error', message: err.message || 'Stream error' })
        if (status.value === 'running') status.value = 'error'
      },
      onDone: () => void refreshSessionMemory(),
    })
    status.value = 'running'
    void activeStream.start(`/api/agent/sessions/${sessionId.value}/continue`, {
      body: { prompt, additionalIterations },
    })
  }

  async function interject(message: string): Promise<void> {
    if (!sessionId.value || !message.trim()) return
    const res = await fetch(`/api/agent/sessions/${sessionId.value}/interject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      toast.push({ kind: 'error', message: body.error || 'Failed to send interjection.' })
      return
    }
    toast.push({ kind: 'info', message: 'Interjection queued for the next iteration.' })
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
