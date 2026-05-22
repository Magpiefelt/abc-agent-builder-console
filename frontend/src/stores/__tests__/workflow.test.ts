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
    tags: [],
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

describe('useWorkflowStore — previewVersion', () => {
  it('loads a version, computes a diff against current, and stores the preview', async () => {
    const detail = {
      workflowId: WORKFLOW_ID,
      version: 2,
      canvasData: {
        nodes: [
          {
            id: 'a',
            type: 'agent',
            position: { x: 0, y: 0 },
            data: {
              kind: 'agent',
              label: 'A',
              modelId: 'claude-haiku-4-5',
              classification: 'unclassified',
              tools: [],
            },
          },
        ],
        edges: [],
        version: 1 as const,
      },
      createdBy: 'u1',
      createdAt: '2026-05-20T09:00:00Z',
    }
    apiFetchMock.mockResolvedValueOnce(detail)

    const store = useWorkflowStore()
    store.current = makeWorkflow({
      canvas_data: { nodes: [], edges: [], version: 1 },
    })

    const result = await store.previewVersion(2)

    expect(apiFetchMock).toHaveBeenCalledWith(`/api/workflows/${WORKFLOW_ID}/versions/2`)
    expect(result).not.toBeNull()
    expect(store.versionPreview?.version).toBe(2)
    expect(store.versionPreview?.summary.nodeAdded).toBe(1)
    expect(store.versionPreview?.summary.hasChanges).toBe(true)
    expect(store.previewLoading).toBe(false)
    expect(store.previewError).toBeNull()
  })

  it('records an error when the version fetch fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('not found'))
    const store = useWorkflowStore()
    store.current = makeWorkflow()
    const result = await store.previewVersion(99)
    expect(result).toBeNull()
    expect(store.versionPreview).toBeNull()
    expect(store.previewError).toBe('not found')
  })

  it('is a no-op when no workflow is loaded', async () => {
    const store = useWorkflowStore()
    const result = await store.previewVersion(2)
    expect(result).toBeNull()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})

describe('useWorkflowStore — clearVersionPreview', () => {
  it('drops the preview, loading and error state', () => {
    const store = useWorkflowStore()
    store.versionPreview = {
      version: 2,
      detail: {
        workflowId: WORKFLOW_ID,
        version: 2,
        canvasData: { nodes: [], edges: [], version: 1 },
        createdBy: 'u',
        createdAt: '',
      },
      diff: {
        addedNodes: [],
        removedNodes: [],
        modifiedNodes: [],
        unchangedNodeCount: 0,
        addedEdges: [],
        removedEdges: [],
        modifiedEdges: [],
        unchangedEdgeCount: 0,
      },
      summary: {
        nodeAdded: 0,
        nodeRemoved: 0,
        nodeModified: 0,
        nodeUnchanged: 0,
        edgeAdded: 0,
        edgeRemoved: 0,
        edgeModified: 0,
        edgeUnchanged: 0,
        hasChanges: false,
      },
    }
    store.previewError = 'something'
    store.clearVersionPreview()
    expect(store.versionPreview).toBeNull()
    expect(store.previewError).toBeNull()
  })
})

describe('useWorkflowStore — restoreVersion clears preview', () => {
  it('clears any open preview after a successful restore', async () => {
    const restored = makeWorkflow({ version: 5 })
    apiFetchMock
      .mockResolvedValueOnce(restored)
      .mockResolvedValueOnce({ currentVersion: 5, versions: [] })
      .mockResolvedValueOnce({ executions: [], count: 0 })

    const store = useWorkflowStore()
    store.current = makeWorkflow()
    store.versionPreview = {
      version: 2,
      detail: {
        workflowId: WORKFLOW_ID,
        version: 2,
        canvasData: { nodes: [], edges: [], version: 1 },
        createdBy: 'u',
        createdAt: '',
      },
      diff: {
        addedNodes: [],
        removedNodes: [],
        modifiedNodes: [],
        unchangedNodeCount: 0,
        addedEdges: [],
        removedEdges: [],
        modifiedEdges: [],
        unchangedEdgeCount: 0,
      },
      summary: {
        nodeAdded: 0,
        nodeRemoved: 0,
        nodeModified: 0,
        nodeUnchanged: 0,
        edgeAdded: 0,
        edgeRemoved: 0,
        edgeModified: 0,
        edgeUnchanged: 0,
        hasChanges: false,
      },
    }

    await store.restoreVersion(2)
    expect(store.versionPreview).toBeNull()
  })
})

describe('useWorkflowStore — exportToFile / importFromFile', () => {
  it('exports the loaded workflow as a JSON file with schemaVersion=1', () => {
    const store = useWorkflowStore()
    store.current = makeWorkflow({
      name: 'My Workflow',
      description: 'A test',
      classification: 'protected_a',
      canvas_data: {
        nodes: [
          {
            id: 'a',
            type: 'agent',
            position: { x: 0, y: 0 },
            data: { kind: 'agent', label: 'A', modelId: 'm', classification: 'unclassified', tools: [] },
          },
        ],
        edges: [],
        version: 1,
      },
    })

    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })

    const click = vi.fn()
    const anchor = document.createElement('a')
    anchor.click = click
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    store.exportToFile()

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json')
    expect(click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toMatch(/\.workflow\.json$/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')

    createElementSpy.mockRestore()
  })

  it('rejects an import with an unsupported schema version', async () => {
    const store = useWorkflowStore()
    const file = fileWithText(JSON.stringify({ schemaVersion: 99, name: 'x' }))
    await expect(store.importFromFile(file)).rejects.toThrow(/schema/i)
  })

  it('rejects an import with malformed JSON', async () => {
    const store = useWorkflowStore()
    const file = fileWithText('{ not json')
    await expect(store.importFromFile(file)).rejects.toThrow(/valid JSON/i)
  })

  it('creates a new workflow from a valid import bundle', async () => {
    const store = useWorkflowStore()
    const created = makeWorkflow({ id: 'new-id', name: 'Imported' })
    apiFetchMock.mockResolvedValueOnce(created)

    const bundle = {
      schemaVersion: 1,
      exportedAt: '2026-05-21T00:00:00Z',
      name: 'Imported',
      description: null,
      classification: 'unclassified',
      canvas_data: { nodes: [], edges: [], version: 1 },
    }
    const file = fileWithText(JSON.stringify(bundle))

    const wf = await store.importFromFile(file)
    expect(wf.id).toBe('new-id')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/workflows',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body as string)
    expect(body.name).toBe('Imported')
    expect(body.classification).toBe('unclassified')
  })
})

// jsdom's File doesn't implement .text(), so we wrap a stub that mimics it
// closely enough for the importer.
function fileWithText(content: string): File {
  return { text: () => Promise.resolve(content) } as unknown as File
}

// ============================================================================
// TAGS (Bot 17, F5)
// ============================================================================

describe('useWorkflowStore — setTags', () => {
  it('updates current.tags and flips dirty when the list changes', () => {
    const store = useWorkflowStore()
    store.current = makeWorkflow({ tags: ['education'] })
    store.dirty = false

    store.setTags(['education', 'research'])
    expect(store.current!.tags).toEqual(['education', 'research'])
    expect(store.dirty).toBe(true)
  })

  it('does not flip dirty when the new list is identical', () => {
    const store = useWorkflowStore()
    store.current = makeWorkflow({ tags: ['education', 'research'] })
    store.dirty = false

    store.setTags(['education', 'research'])
    expect(store.dirty).toBe(false)
  })

  it('removes tags when the new list is shorter', () => {
    const store = useWorkflowStore()
    store.current = makeWorkflow({ tags: ['education', 'research'] })
    store.dirty = false

    store.setTags(['education'])
    expect(store.current!.tags).toEqual(['education'])
    expect(store.dirty).toBe(true)
  })

  it('is a no-op when no workflow is loaded', () => {
    const store = useWorkflowStore()
    store.current = null
    // No throw — silent no-op.
    store.setTags(['education'])
    expect(store.current).toBeNull()
  })
})

describe('useWorkflowStore — save with tags', () => {
  it('includes the current tags in the PUT body', async () => {
    const store = useWorkflowStore()
    store.current = makeWorkflow({ tags: ['education', 'research'] })
    apiFetchMock.mockResolvedValueOnce(makeWorkflow({ tags: ['education', 'research'] }))

    await store.save()
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body as string)
    expect(body.tags).toEqual(['education', 'research'])
  })

  it('falls back to [] when current.tags is undefined', async () => {
    const store = useWorkflowStore()
    // Force an undefined tags value (e.g. legacy backend response).
    store.current = { ...makeWorkflow(), tags: undefined as unknown as string[] }
    apiFetchMock.mockResolvedValueOnce(makeWorkflow({ tags: [] }))

    await store.save()
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body as string)
    expect(body.tags).toEqual([])
  })
})

describe('useWorkflowStore — duplicate inherits tags', () => {
  it('passes the source workflow tags through to create()', async () => {
    const store = useWorkflowStore()

    apiFetchMock
      // GET source workflow
      .mockResolvedValueOnce(
        makeWorkflow({
          name: 'Researcher',
          tags: ['education', 'research'],
        }),
      )
      // POST create new workflow
      .mockResolvedValueOnce(
        makeWorkflow({
          id: 'new-id',
          name: 'Researcher (copy)',
          tags: ['education', 'research'],
        }),
      )

    const newWf = await store.duplicate(WORKFLOW_ID)
    expect(newWf.tags).toEqual(['education', 'research'])
    const createBody = JSON.parse(apiFetchMock.mock.calls[1][1].body as string)
    expect(createBody.tags).toEqual(['education', 'research'])
  })
})

