<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  AgentTemplate,
  FunctionCatalogEntry,
  NodeData,
  NodeKind,
  ToolManifestEntry,
} from '@/types/workflow'

const props = defineProps<{
  agentTemplates: AgentTemplate[]
  functionCatalog: FunctionCatalogEntry[]
  tools: ToolManifestEntry[]
}>()

const search = ref('')

const filteredAgents = computed(() =>
  props.agentTemplates.filter((t) =>
    matches(search.value, t.name, t.description, t.id)
  )
)

const filteredFunctions = computed(() => {
  const filtered = props.functionCatalog.filter((f) =>
    matches(search.value, f.name, f.description, f.category)
  )
  // Group by category
  const groups: Record<string, FunctionCatalogEntry[]> = {}
  for (const f of filtered) {
    const bucket = groups[f.category] ?? []
    bucket.push(f)
    groups[f.category] = bucket
  }
  return groups
})

const filteredTools = computed(() => {
  const filtered = props.tools.filter((t) =>
    matches(search.value, t.name, t.description, t.category)
  )
  const groups: Record<string, ToolManifestEntry[]> = {}
  for (const t of filtered) {
    const bucket = groups[t.category] ?? []
    bucket.push(t)
    groups[t.category] = bucket
  }
  return groups
})

function matches(query: string, ...fields: string[]): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return fields.some((f) => f && f.toLowerCase().includes(q))
}

function dragStart(event: DragEvent, kind: NodeKind, defaults: Partial<NodeData>): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/abc.node', JSON.stringify({ kind, defaults }))
  event.dataTransfer.effectAllowed = 'move'
}

function agentDefaults(t: AgentTemplate): Partial<NodeData> {
  return {
    kind: 'agent',
    label: t.name,
    templateId: t.id,
    modelId: t.defaultModel,
    classification: 'unclassified',
    tools: t.defaultTools,
  }
}

function functionDefaults(f: FunctionCatalogEntry): Partial<NodeData> {
  const params: Record<string, unknown> = {}
  for (const p of f.params) {
    if (p.default !== undefined) params[p.name] = p.default
  }
  return { kind: 'function', label: f.name, fnName: f.name, params }
}

function toolDefaults(t: ToolManifestEntry): Partial<NodeData> {
  return { kind: 'tool', label: t.name, toolName: t.name, params: {} }
}

function noteDefaults(): Partial<NodeData> {
  return { kind: 'note', label: 'Note', markdown: '' }
}
</script>

<template>
  <aside class="w-72 bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] flex flex-col overflow-hidden">
    <div class="p-3 border-b border-[var(--goa-color-border)]">
      <goa-input
        name="library-search"
        type="search"
        :value="search"
        placeholder="Search library…"
        leadingicon="search"
        width="100%"
        @_change="(e: CustomEvent<{ value: string }>) => (search = e.detail.value)"
      ></goa-input>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- Agents -->
      <details open class="border-b border-[var(--goa-color-border)]">
        <summary class="px-3 py-2 cursor-pointer font-semibold text-sm text-[var(--goa-color-primary-dark)] select-none">
          Agents
        </summary>
        <div class="px-2 pb-2 space-y-1">
          <div
            v-for="t in filteredAgents"
            :key="t.id"
            draggable="true"
            @dragstart="dragStart($event, 'agent', agentDefaults(t))"
            class="px-2 py-1.5 text-sm rounded cursor-grab hover:bg-[var(--goa-color-primary-light)] border border-transparent hover:border-[var(--goa-color-primary)]"
          >
            <div class="font-medium">{{ t.name }}</div>
            <div class="text-xs text-[var(--goa-color-text-secondary)] truncate">{{ t.description }}</div>
          </div>
        </div>
      </details>

      <!-- Functions -->
      <details class="border-b border-[var(--goa-color-border)]">
        <summary class="px-3 py-2 cursor-pointer font-semibold text-sm text-[var(--goa-color-primary-dark)] select-none">
          Functions
        </summary>
        <div class="px-2 pb-2 space-y-2">
          <div v-for="(items, cat) in filteredFunctions" :key="cat">
            <div class="px-2 pt-1 text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">{{ cat }}</div>
            <div
              v-for="f in items"
              :key="f.name"
              draggable="true"
              @dragstart="dragStart($event, 'function', functionDefaults(f))"
              :title="f.description"
              class="px-2 py-1 text-sm rounded cursor-grab hover:bg-[var(--goa-color-primary-light)] border border-transparent hover:border-[var(--goa-color-primary)] flex items-center gap-2"
            >
              <span class="font-mono text-xs flex-1 truncate">{{ f.name }}</span>
              <goa-badge
                v-if="f.category === 'branch'"
                type="important"
                content="branch"
              ></goa-badge>
            </div>
          </div>
        </div>
      </details>

      <!-- Tools -->
      <details class="border-b border-[var(--goa-color-border)]">
        <summary class="px-3 py-2 cursor-pointer font-semibold text-sm text-[var(--goa-color-primary-dark)] select-none">
          Tools
        </summary>
        <div class="px-2 pb-2 space-y-2">
          <div v-for="(items, cat) in filteredTools" :key="cat">
            <div class="px-2 pt-1 text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">{{ cat }}</div>
            <div
              v-for="t in items"
              :key="t.name"
              draggable="true"
              @dragstart="dragStart($event, 'tool', toolDefaults(t))"
              class="px-2 py-1 text-sm rounded cursor-grab hover:bg-[var(--goa-color-primary-light)] border border-transparent hover:border-[var(--goa-color-primary)]"
            >
              <div class="font-mono text-xs">{{ t.name }}</div>
              <div class="text-xs text-[var(--goa-color-text-secondary)] truncate">{{ t.description }}</div>
            </div>
          </div>
        </div>
      </details>

      <!-- Notes -->
      <details class="border-b border-[var(--goa-color-border)]">
        <summary class="px-3 py-2 cursor-pointer font-semibold text-sm text-[var(--goa-color-primary-dark)] select-none">
          Notes
        </summary>
        <div class="px-2 pb-2">
          <div
            draggable="true"
            @dragstart="dragStart($event, 'note', noteDefaults())"
            class="px-2 py-1.5 text-sm rounded cursor-grab hover:bg-[var(--goa-color-warning)]/20 border border-transparent hover:border-[var(--goa-color-warning)]"
          >
            <div class="font-medium">Sticky Note</div>
            <div class="text-xs text-[var(--goa-color-text-secondary)]">Annotate the canvas. Skipped at run time.</div>
          </div>
        </div>
      </details>
    </div>
  </aside>
</template>
