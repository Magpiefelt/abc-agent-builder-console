/**
 * Frontend workflow store — dry-run path tests.
 *
 * Pins the contract that store.execute({ dryRun: true }) sends the right body
 * to the SSE endpoint and stashes the dryRun flag on ExecutionState so the
 * ExecutionPanel banner renders from the first frame.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useApiFetch', () => ({
  apiFetch: apiFetchMock,
}))

const sseStartMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useSSEStream', () => ({
  useSSEStream: () => ({
    start: sseStartMock,
    abort: vi.fn(),
  }),
}))

import { useWorkflowStore } from '@/stores/workflow'
import type { Workflow } from '@/types/workflow'

const WORKFLOW_ID = '11111111-1111-1111-1111-111111111111'

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW_ID,
    name: 'Test workflow',
    description: null,
    classification: 'unclassified',
    version: 3,
    is_template: false,
    tags: [],
    ministry_code: 'INFRA',
    user_id: 'u1',
    created_at: '2026-05-20T09:00:00Z',
    updated_at: '2026-05-21T10:00:00Z',
    canvas_data: {
      nodes: [
        {
          id: 'n1',
          type: 'function',
          position: { x: 0, y: 0 },
          data: { kind: 'function', label: 'Upper', fnName: 'to_upper', params: {} },
        },
      ],
      edges: [],
      version: 1,
    },
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetchMock.mockReset()
  sseStartMock.mockReset().mockResolvedValue(undefined)
})

describe('useWorkflowStore — execute({ dryRun: true })', () => {
  it('POSTs to the execute endpoint with dryRun: true in the body', async () => {
    const store = useWorkflowStore()
    store.$patch({ current: makeWorkflow() })

    await store.execute({ dryRun: true })

    expect(sseStartMock).toHaveBeenCalledTimes(1)
    const [url, opts] = sseStartMock.mock.calls[0] as [string, { body: { dryRun: boolean; continueOnError: boolean } }]
    expect(url).toBe(`/api/workflows/${WORKFLOW_ID}/execute`)
    expect(opts.body.dryRun).toBe(true)
    expect(opts.body.continueOnError).toBe(false)
  })

  it('sets execution.dryRun = true on the active execution state', async () => {
    const store = useWorkflowStore()
    store.$patch({ current: makeWorkflow() })

    await store.execute({ dryRun: true })

    expect(store.execution).not.toBeNull()
    expect(store.execution!.dryRun).toBe(true)
    expect(store.execution!.status).toBe('running')
  })

  it('defaults dryRun to false when called with no options', async () => {
    const store = useWorkflowStore()
    store.$patch({ current: makeWorkflow() })

    await store.execute()

    const [, opts] = sseStartMock.mock.calls[0] as [string, { body: { dryRun: boolean } }]
    expect(opts.body.dryRun).toBe(false)
    expect(store.execution!.dryRun).toBe(false)
  })

  it('preserves backwards compatibility with the legacy boolean signature', async () => {
    const store = useWorkflowStore()
    store.$patch({ current: makeWorkflow() })

    // Old callsites passed continueOnError as a single boolean argument.
    await store.execute(true)

    const [, opts] = sseStartMock.mock.calls[0] as [
      string,
      { body: { dryRun: boolean; continueOnError: boolean } },
    ]
    expect(opts.body.continueOnError).toBe(true)
    expect(opts.body.dryRun).toBe(false)
  })

  it('forwards continueOnError alongside dryRun when both are provided', async () => {
    const store = useWorkflowStore()
    store.$patch({ current: makeWorkflow() })

    await store.execute({ dryRun: true, continueOnError: true })

    const [, opts] = sseStartMock.mock.calls[0] as [
      string,
      { body: { dryRun: boolean; continueOnError: boolean } },
    ]
    expect(opts.body.dryRun).toBe(true)
    expect(opts.body.continueOnError).toBe(true)
  })

  it('does nothing when there is no current workflow', async () => {
    const store = useWorkflowStore()

    await store.execute({ dryRun: true })

    expect(sseStartMock).not.toHaveBeenCalled()
    expect(store.execution).toBeNull()
  })

  it('does not start a second execution while one is already running', async () => {
    const store = useWorkflowStore()
    store.$patch({ current: makeWorkflow() })

    await store.execute({ dryRun: true })
    expect(sseStartMock).toHaveBeenCalledTimes(1)

    await store.execute({ dryRun: true })
    expect(sseStartMock).toHaveBeenCalledTimes(1)
  })
})
