import { describe, it, expect } from 'vitest'
import { validateCanvas, kindLabel, type IssueCode } from '../workflowValidator'
import type {
  AgentNodeData,
  CanvasData,
  CanvasEdge,
  CanvasNode,
  FunctionCatalogEntry,
  FunctionNodeData,
  NoteNodeData,
  ToolManifestEntry,
  ToolNodeData,
  WorkflowLibrary,
} from '@/types/workflow'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function agentNode(id: string, overrides: Partial<AgentNodeData> = {}): CanvasNode {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      label: id,
      modelId: 'claude-haiku-4-5',
      classification: 'unclassified',
      tools: [],
      templateId: 'researcher',
      ...overrides,
    },
  }
}

function functionNode(id: string, overrides: Partial<FunctionNodeData> = {}): CanvasNode {
  return {
    id,
    type: 'function',
    position: { x: 0, y: 0 },
    data: {
      kind: 'function',
      label: id,
      fnName: 'to_upper',
      params: {},
      ...overrides,
    },
  }
}

function toolNode(id: string, overrides: Partial<ToolNodeData> = {}): CanvasNode {
  return {
    id,
    type: 'tool',
    position: { x: 0, y: 0 },
    data: {
      kind: 'tool',
      label: id,
      toolName: 'brave_search',
      params: { query: 'alberta' },
      ...overrides,
    },
  }
}

function noteNode(id: string, overrides: Partial<NoteNodeData> = {}): CanvasNode {
  return {
    id,
    type: 'note',
    position: { x: 0, y: 0 },
    data: {
      kind: 'note',
      label: id,
      markdown: 'Note',
      ...overrides,
    },
  }
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, source, target }
}

function canvas(nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasData {
  return { nodes, edges, version: 1 }
}

function libraryFixture(
  overrides: { functions?: FunctionCatalogEntry[]; tools?: ToolManifestEntry[] } = {},
): WorkflowLibrary {
  return {
    agentTemplates: [],
    functionCatalog: overrides.functions ?? [
      {
        name: 'to_upper',
        category: 'text-transform',
        description: 'Uppercase',
        params: [],
        outputType: 'string',
      },
      {
        name: 'replace',
        category: 'text-transform',
        description: 'Replace',
        params: [
          { name: 'find', type: 'string', required: true },
          { name: 'replacement', type: 'string', required: true, default: '' },
        ],
        outputType: 'string',
      },
      {
        name: 'truncate',
        category: 'text-transform',
        description: 'Truncate',
        params: [
          { name: 'maxLength', type: 'number', required: true, default: 200 },
        ],
        outputType: 'string',
      },
    ],
    tools: overrides.tools ?? [
      {
        name: 'brave_search',
        category: 'web_search',
        description: 'Search',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            numResults: { type: 'number', default: 10 },
          },
          required: ['query'],
        },
      },
    ],
  }
}

function codesOf(issues: { code: IssueCode }[]): IssueCode[] {
  return issues.map((i) => i.code)
}

// ---------------------------------------------------------------------------
// Structural checks
// ---------------------------------------------------------------------------

describe('validateCanvas — graph structure', () => {
  it('flags an empty graph as a single error', () => {
    const result = validateCanvas(canvas([]))
    expect(codesOf(result.issues)).toEqual(['empty_graph'])
    expect(result.counts.error).toBe(1)
    expect(result.runnable).toBe(false)
  })

  it('handles null canvas gracefully', () => {
    const result = validateCanvas(null)
    expect(result.issues).toEqual([])
    expect(result.runnable).toBe(true)
    expect(result.counts.total).toBe(0)
  })

  it('passes a clean linear DAG', () => {
    const result = validateCanvas(
      canvas([agentNode('a'), agentNode('b')], [edge('e1', 'a', 'b')]),
      libraryFixture(),
    )
    expect(result.issues).toEqual([])
    expect(result.runnable).toBe(true)
  })

  it('detects duplicate node IDs', () => {
    const result = validateCanvas(canvas([agentNode('a'), agentNode('a')]))
    const codes = codesOf(result.issues)
    expect(codes).toContain('duplicate_node_id')
    const dup = result.issues.find((i) => i.code === 'duplicate_node_id')!
    expect(dup.details).toMatchObject({ count: 2 })
    expect(dup.severity).toBe('error')
  })

  it('flags edges pointing at missing nodes', () => {
    const result = validateCanvas(
      canvas([agentNode('a')], [edge('e1', 'a', 'ghost')]),
    )
    const issue = result.issues.find((i) => i.code === 'edge_missing_endpoint')
    expect(issue).toBeTruthy()
    expect(issue!.severity).toBe('error')
    expect(issue!.message).toMatch(/unknown target/i)
    // Should attach to the existing endpoint so the user can click and see it.
    expect(issue!.nodeId).toBe('a')
  })

  it('flags edges where both endpoints are missing as graph-wide', () => {
    const result = validateCanvas(
      canvas([agentNode('a')], [edge('e1', 'x', 'y')]),
    )
    const issue = result.issues.find((i) => i.code === 'edge_missing_endpoint')!
    expect(issue.nodeId).toBeNull()
  })

  it('detects a two-node cycle', () => {
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b')],
        [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
      ),
      libraryFixture(),
    )
    const cycleIssues = result.issues.filter((i) => i.code === 'cycle')
    expect(cycleIssues.length).toBe(2)
    expect(cycleIssues.map((i) => i.nodeId).sort()).toEqual(['a', 'b'])
  })

  it('detects a self-loop as a cycle', () => {
    const result = validateCanvas(
      canvas([agentNode('a')], [edge('e1', 'a', 'a')]),
      libraryFixture(),
    )
    const cycleIssue = result.issues.find((i) => i.code === 'cycle')
    expect(cycleIssue).toBeTruthy()
    expect(cycleIssue!.nodeId).toBe('a')
  })

  it('flags orphan / unreachable nodes when an entry exists', () => {
    // Entry a → b. Orphan c is unreachable.
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b'), agentNode('c')],
        [edge('e1', 'a', 'b')],
      ),
      libraryFixture(),
    )
    // Orphans are warnings.
    const orphan = result.issues.find((i) => i.code === 'orphan_node')
    expect(orphan).toBeTruthy()
    expect(orphan!.severity).toBe('warning')
    expect(orphan!.nodeId).toBe('c')
  })

  it('does NOT flag note nodes as orphans', () => {
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b'), noteNode('doc')],
        [edge('e1', 'a', 'b')],
      ),
      libraryFixture(),
    )
    expect(result.issues.find((i) => i.code === 'orphan_node')).toBeUndefined()
  })

  it('flags multiple entry points as info-level', () => {
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b'), agentNode('c')],
        [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
      ),
      libraryFixture(),
    )
    const issue = result.issues.find((i) => i.code === 'multiple_entries')
    expect(issue).toBeTruthy()
    expect(issue!.severity).toBe('info')
    expect((issue!.details as { entryIds: string[] }).entryIds.sort()).toEqual(['a', 'b'])
  })

  it('warns when every node has an outgoing edge (no terminal)', () => {
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b')],
        [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
      ),
      libraryFixture(),
    )
    // Note: this graph has a cycle too. We still expect the no_terminal warning
    // to fire because every node has out-degree > 0.
    const noTerm = result.issues.find((i) => i.code === 'no_terminal')
    expect(noTerm).toBeTruthy()
    expect(noTerm!.severity).toBe('warning')
  })

  it('does not flag orphans when the graph is one big cycle (cycle issue takes priority)', () => {
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b')],
        [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
      ),
      libraryFixture(),
    )
    expect(result.issues.find((i) => i.code === 'orphan_node')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Agent node config
// ---------------------------------------------------------------------------

describe('validateCanvas — agent nodes', () => {
  it('flags missing modelId', () => {
    const result = validateCanvas(canvas([agentNode('a', { modelId: '' })]))
    expect(codesOf(result.issues)).toContain('agent_missing_model')
  })

  it('flags whitespace-only modelId', () => {
    const result = validateCanvas(canvas([agentNode('a', { modelId: '   ' })]))
    expect(codesOf(result.issues)).toContain('agent_missing_model')
  })

  it('flags missing prompt and template both', () => {
    const result = validateCanvas(
      canvas([agentNode('a', { templateId: undefined, systemPromptOverride: undefined })]),
    )
    expect(codesOf(result.issues)).toContain('agent_missing_prompt')
  })

  it('accepts a template alone', () => {
    const result = validateCanvas(
      canvas([
        agentNode('a', {
          templateId: 'researcher',
          systemPromptOverride: undefined,
        }),
      ]),
    )
    expect(codesOf(result.issues)).not.toContain('agent_missing_prompt')
  })

  it('accepts a custom prompt alone', () => {
    const result = validateCanvas(
      canvas([
        agentNode('a', {
          templateId: undefined,
          systemPromptOverride: 'You are…',
        }),
      ]),
    )
    expect(codesOf(result.issues)).not.toContain('agent_missing_prompt')
  })
})

// ---------------------------------------------------------------------------
// Function node config
// ---------------------------------------------------------------------------

describe('validateCanvas — function nodes', () => {
  it('flags missing fnName', () => {
    const result = validateCanvas(
      canvas([functionNode('f', { fnName: '' })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).toContain('function_missing_name')
  })

  it('flags an fnName that is not in the catalog', () => {
    const result = validateCanvas(
      canvas([functionNode('f', { fnName: 'bogus_function' })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).toContain('function_unknown_name')
  })

  it('skips the catalog-lookup checks when no library is provided', () => {
    const result = validateCanvas(
      canvas([functionNode('f', { fnName: 'bogus_function' })]),
      // No library.
    )
    expect(codesOf(result.issues)).not.toContain('function_unknown_name')
  })

  it('flags missing required params (no default)', () => {
    const result = validateCanvas(
      canvas([functionNode('f', { fnName: 'replace', params: { replacement: 'x' } })]),
      libraryFixture(),
    )
    const missing = result.issues.find((i) => i.code === 'function_missing_param')
    expect(missing).toBeTruthy()
    expect((missing!.details as { param: string }).param).toBe('find')
  })

  it('does NOT flag required params that have a default', () => {
    const result = validateCanvas(
      canvas([functionNode('f', { fnName: 'truncate', params: {} })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).not.toContain('function_missing_param')
  })

  it('treats empty-string param as missing', () => {
    const result = validateCanvas(
      canvas([functionNode('f', { fnName: 'replace', params: { find: '', replacement: 'x' } })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).toContain('function_missing_param')
  })
})

// ---------------------------------------------------------------------------
// Tool node config
// ---------------------------------------------------------------------------

describe('validateCanvas — tool nodes', () => {
  it('flags missing toolName', () => {
    const result = validateCanvas(
      canvas([toolNode('t', { toolName: '' })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).toContain('tool_missing_name')
  })

  it('flags an unknown toolName', () => {
    const result = validateCanvas(
      canvas([toolNode('t', { toolName: 'bogus_tool' })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).toContain('tool_unknown_name')
  })

  it('flags missing required tool params', () => {
    const result = validateCanvas(
      canvas([toolNode('t', { toolName: 'brave_search', params: {} })]),
      libraryFixture(),
    )
    expect(codesOf(result.issues)).toContain('tool_missing_param')
  })

  it('respects manifest defaults — does not flag a defaulted required param', () => {
    const result = validateCanvas(
      canvas([toolNode('t', { toolName: 'brave_search', params: { query: 'alberta' } })]),
      libraryFixture({
        tools: [
          {
            name: 'brave_search',
            category: 'web_search',
            description: '',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', default: 'alberta' },
              },
              required: ['query'],
            },
          },
        ],
      }),
    )
    expect(codesOf(result.issues)).not.toContain('tool_missing_param')
  })

  it('skips manifest-dependent checks when no library is provided', () => {
    const result = validateCanvas(
      canvas([toolNode('t', { toolName: 'anything', params: {} })]),
    )
    // tool_missing_name should NOT fire (toolName is set);
    // unknown / missing-param should NOT fire (no library).
    expect(codesOf(result.issues)).not.toContain('tool_unknown_name')
    expect(codesOf(result.issues)).not.toContain('tool_missing_param')
  })
})

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

describe('validateCanvas — counts and runnable flag', () => {
  it('counts errors / warnings / info separately', () => {
    const result = validateCanvas(
      canvas(
        [
          // entry 1 → b
          agentNode('a'),
          agentNode('b'),
          // entry 2 → c (multi-entry info)
          agentNode('c', { modelId: '' }), // error
          // orphan, unreachable (warning)
          agentNode('orphan'),
        ],
        [edge('e1', 'a', 'b'), edge('e2', 'c', 'b')],
      ),
      libraryFixture(),
    )
    expect(result.counts.error).toBeGreaterThanOrEqual(1)
    expect(result.counts.warning).toBeGreaterThanOrEqual(1)
    expect(result.counts.info).toBeGreaterThanOrEqual(1)
    expect(result.counts.total).toBe(
      result.counts.error + result.counts.warning + result.counts.info,
    )
    expect(result.runnable).toBe(false)
  })

  it('is runnable when only warnings/info are present', () => {
    // Two entry points → info; no terminal → warning. No errors.
    const result = validateCanvas(
      canvas(
        [agentNode('a'), agentNode('b'), agentNode('c')],
        [
          edge('e1', 'a', 'c'),
          edge('e2', 'b', 'c'),
          edge('e3', 'c', 'a'), // creates a cycle → error; flip to remove
        ],
      ),
      libraryFixture(),
    )
    // The cycle creates an error so this isn't runnable; check the other case.
    expect(result.runnable).toBe(false)
    const onlyInfoCanvas = canvas(
      [agentNode('a'), agentNode('b'), agentNode('c')],
      [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
    )
    const ok = validateCanvas(onlyInfoCanvas, libraryFixture())
    expect(ok.runnable).toBe(true)
    expect(ok.counts.error).toBe(0)
    expect(ok.counts.info).toBeGreaterThan(0)
  })
})

describe('kindLabel', () => {
  it('returns a human label for every node kind', () => {
    expect(kindLabel('agent')).toBe('Agent')
    expect(kindLabel('function')).toBe('Function')
    expect(kindLabel('tool')).toBe('Tool')
    expect(kindLabel('note')).toBe('Note')
  })
})
