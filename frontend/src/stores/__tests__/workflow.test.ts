/**
 * Workflow store — coverage for the version + execution history actions added
 * on top of the Stream C CRUD/SSE store. We stub apiFetch so the test runs
 * without a backend and assert the store mutates correctly for each call.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useApiFetch', () => ({
  apiFetch: apiFetchMock,
}))
vi.mock('@/composables/useSSEStream', () => ({
  useSSEStream: () => ({
    start: vi.fn(),
    abort: vi.fn(),
  }),
}))

import { useWorkflowStore } from '@/stores/workflow'
import type { Workflow } from '@/types/workflow'

const WORKFLOW_ID = '11111111-1111-1111-1111-111111111111'
const EXECUTION_ID = '22222222-2222-2222-2222-222222222222'

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW_ID,
    name: 'Test workflow',
    description: null,
    classification: 'unclassified',
    version: 3,
    is_template: false,
    ministry_code: 'INFRA',
    user_id: 'u1',
    created_at: '2026-05-20T09:00:00Z',
    updated_at: '2026-05-21T10:00:00Z',
    canvas_data: { nodes: [], edges: [], version: 1 },
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiFetchMock.mockReset()
})

describe('useWorkflowStore — loadHistory', () => {
  it('fetches versions and executions in parallel and tracks the workflow id', async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        currentVersion: 3,
        versions: [
          { version: 3, createdBy: 'u1', createdByEmail: null, createdByDisplayName: null, createdAt: '2026-05-21T10:00:00Z' },
          { version: 2, createdBy: 'u1', createdByEmail: null, createdByDisplayName: null, createdAt: '2026-05-20T09:00:00Z' },
        ],
      })
      .mockResolvedValueOnce({
        executions: [
          {
            id: EXECUTION_ID,
            workflowId: WORKFLOW_ID,
            userId: 'u1',
            userEmail: null,
            userDisplayName: null,
            classification: 'unclassified',
            status: 'completed',
            error: null,
            stageCount: 2,
            durationMs: 5000,
            startedAt: '2026-05-21T10:00:00Z',
            completedAt: '2026-05-21T10:00:05Z',
          },
        ],
        count: 1,
      })

    const store = useWorkflowStore()
    await store.loadHistory(WORKFLOW_ID)

    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/workflows/${WORKFLOW_ID}/versions`,
    )
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/workflows/${WORKFLOW_ID}/executions?limit=50`,
    )
    expect(store.versions).toHaveLength(2)
    expect(store.currentVersion).toBe(3)
    expect(store.executions).toHaveLength(1)
    expect(store.historyKey).toBe(WORKFLOW_ID)
    expect(store.historyError).toBeNull()
  })

  it('records error state when the API call fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'))
    apiFetchMock.mockResolvedValueOnce({ executions: [], count: 0 })

    const store = useWorkflowStore()
    await store.loadHistory(WORKFLOW_ID)

    expect(store.historyError).toBe('boom')
    expect(store.historyLoading).toBe(false)
  })
})

describe('useWorkflowStore — restoreVersion', () => {
  it('POSTs to the restore endpoint, replaces current canvas, refreshes history', async () => {
    const restored = makeWorkflow({ version: 4 })
    apiFetchMock
      // restore POST
      .mockResolvedValueOnce(restored)
      // loadHistory: versions
      .mockResolvedValueOnce({
        currentVersion: 4,
        versions: [],
      })
      // loadHistory: executions
      .mockResolvedValueOnce({ executions: [], count: 0 })

    const store = useWorkflowStore()
    // Seed the store with a loaded workflow
    store.current = makeWorkflow()

    await store.restoreVersion(2)

    const firstCall = apiFetchMock.mock.calls[0]
    expect(firstCall[0]).toBe(`/api/workflows/${WORKFLOW_ID}/versions/2/restore`)
    expect(firstCall[1]).toMatchObject({ method: 'POST' })
    expect(store.current?.version).toBe(4)
    expect(store.dirty).toBe(false)
  })

  it('is a no-op when no workflow is loaded', async () => {
    const store = useWorkflowStore()
    await store.restoreVersion(2)
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})

describe('useWorkflowStore — loadVersionCanvas / loadExecutionDetail', () => {
  it('pulls a single historical version', async () => {
    const detail = {
      workflowId: WORKFLOW_ID,
      version: 2,
      canvasData: { nodes: [], edges: [], version: 1 },
      createdBy: 'u1',
      createdAt: '2026-05-20T09:00:00Z',
    }
    apiFetchMock.mockResolvedValueOnce(detail)
    const store = useWorkflowStore()
    const result = await store.loadVersionCanvas(WORKFLOW_ID, 2)
    expect(result).toEqual(detail)
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/workflows/${WORKFLOW_ID}/versions/2`,
    )
  })

  it('pulls a single execution detail with stage_results', async () => {
    const detail = {
      id: EXECUTION_ID,
      workflowId: WORKFLOW_ID,
      userId: 'u1',
      userEmail: null,
      userDisplayName: null,
      classification: 'unclassified',
      status: 'completed',
      stageResults: [
        { nodeId: 'a', kind: 'agent', status: 'completed', durationMs: 200, value: 'ok' },
      ],
      error: null,
      durationMs: 1000,
      startedAt: '2026-05-21T10:00:00Z',
      completedAt: '2026-05-21T10:00:01Z',
      stageCount: 1,
    }
    apiFetchMock.mockResolvedValueOnce(detail)
    const store = useWorkflowStore()
    const result = await store.loadExecutionDetail(WORKFLOW_ID, EXECUTION_ID)
    expect(result).toEqual(detail)
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}`,
    )
  })
})

describe('useWorkflowStore — clearHistory', () => {
  it('resets versions, executions, and key', () => {
    const store = useWorkflowStore()
    store.versions = [
      { version: 1, createdBy: 'u', createdByEmail: null, createdByDisplayName: null, createdAt: '' },
    ]
    store.executions = [
      {
        id: EXECUTION_ID,
        workflowId: WORKFLOW_ID,
        userId: 'u',
        userEmail: null,
        userDisplayName: null,
        classification: 'unclassified',
        status: 'completed',
        error: null,
        stageCount: 0,
        durationMs: null,
        startedAt: '',
        completedAt: null,
      },
    ]
    store.historyKey = WORKFLOW_ID
    store.clearHistory()
    expect(store.versions).toEqual([])
    expect(store.executions).toEqual([])
    expect(store.historyKey).toBeNull()
  })
})
