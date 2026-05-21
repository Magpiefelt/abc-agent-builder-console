<script setup lang="ts">
import { computed } from 'vue'
import type {
  AgentNodeData,
  AgentTemplate,
  CanvasNode,
  FunctionCatalogEntry,
  FunctionNodeData,
  NodeData,
  NoteNodeData,
  ToolManifestEntry,
  ToolNodeData,
} from '@/types/workflow'

const props = defineProps<{
  node: CanvasNode | null
  agentTemplates: AgentTemplate[]
  functionCatalog: FunctionCatalogEntry[]
  tools: ToolManifestEntry[]
  models: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:node', patch: Partial<NodeData>): void
  (e: 'remove'): void
}>()

const currentTemplate = computed(() => {
  if (props.node?.data.kind !== 'agent') return null
  return props.agentTemplates.find((t) => t.id === (props.node!.data as AgentNodeData).templateId) ?? null
})

const currentFunctionEntry = computed(() => {
  if (props.node?.data.kind !== 'function') return null
  return props.functionCatalog.find((f) => f.name === (props.node!.data as FunctionNodeData).fnName) ?? null
})

const currentToolEntry = computed(() => {
  if (props.node?.data.kind !== 'tool') return null
  return props.tools.find((t) => t.name === (props.node!.data as ToolNodeData).toolName) ?? null
})

function update(key: string, value: unknown): void {
  if (!props.node) return
  emit('update:node', { [key]: value } as Partial<NodeData>)
}

function updateParam(name: string, value: unknown): void {
  if (!props.node) return
  const params = (props.node.data as FunctionNodeData | ToolNodeData).params ?? {}
  emit('update:node', { params: { ...params, [name]: value } } as Partial<NodeData>)
}
</script>

<template>
  <aside class="w-80 bg-[var(--goa-color-surface)] border-l border-[var(--goa-color-border)] flex flex-col overflow-hidden">
    <div class="px-4 py-3 border-b border-[var(--goa-color-border)] flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[var(--goa-color-primary-dark)]">Properties</h3>
      <button
        v-if="node"
        @click="emit('remove')"
        class="text-xs text-[var(--goa-color-error)] hover:underline"
      >
        Delete node
      </button>
    </div>

    <div v-if="!node" class="flex-1 flex items-center justify-center text-sm text-[var(--goa-color-text-secondary)] p-4 text-center">
      Select a node to edit its properties.
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
      <div>
        <label class="block text-xs font-medium mb-1">Label</label>
        <input
          :value="node.data.label"
          @input="update('label', ($event.target as HTMLInputElement).value)"
          class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
        />
      </div>

      <!-- AGENT -->
      <template v-if="node.data.kind === 'agent'">
        <div>
          <label class="block text-xs font-medium mb-1">Template</label>
          <select
            :value="(node.data as AgentNodeData).templateId ?? ''"
            @change="update('templateId', ($event.target as HTMLSelectElement).value || undefined)"
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          >
            <option value="">(custom)</option>
            <option v-for="t in agentTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <p v-if="currentTemplate" class="text-xs text-[var(--goa-color-text-secondary)] mt-1">{{ currentTemplate.description }}</p>
        </div>

        <div>
          <label class="block text-xs font-medium mb-1">Model</label>
          <select
            :value="(node.data as AgentNodeData).modelId"
            @change="update('modelId', ($event.target as HTMLSelectElement).value)"
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          >
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium mb-1">System Prompt Override</label>
          <textarea
            :value="(node.data as AgentNodeData).systemPromptOverride ?? ''"
            @input="update('systemPromptOverride', ($event.target as HTMLTextAreaElement).value || undefined)"
            rows="6"
            placeholder="Leave empty to use the template's default prompt."
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs font-medium mb-1">Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              :value="(node.data as AgentNodeData).temperature ?? ''"
              @input="update('temperature', Number(($event.target as HTMLInputElement).value) || undefined)"
              class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
            />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Max Tokens</label>
            <input
              type="number"
              min="1"
              :value="(node.data as AgentNodeData).maxTokens ?? ''"
              @input="update('maxTokens', Number(($event.target as HTMLInputElement).value) || undefined)"
              class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
            />
          </div>
        </div>
      </template>

      <!-- FUNCTION -->
      <template v-else-if="node.data.kind === 'function'">
        <div>
          <label class="block text-xs font-medium mb-1">Function</label>
          <select
            :value="(node.data as FunctionNodeData).fnName"
            @change="update('fnName', ($event.target as HTMLSelectElement).value)"
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          >
            <option v-for="f in functionCatalog" :key="f.name" :value="f.name">{{ f.category }} · {{ f.name }}</option>
          </select>
          <p v-if="currentFunctionEntry" class="text-xs text-[var(--goa-color-text-secondary)] mt-1">{{ currentFunctionEntry.description }}</p>
        </div>

        <div v-if="currentFunctionEntry && currentFunctionEntry.params.length > 0">
          <div class="text-xs font-medium mb-1">Parameters</div>
          <div class="space-y-2">
            <div v-for="p in currentFunctionEntry.params" :key="p.name">
              <label class="block text-xs font-mono">{{ p.name }}<span v-if="p.required" class="text-[var(--goa-color-error)]"> *</span></label>
              <input
                v-if="p.type === 'number'"
                type="number"
                :value="(node.data as FunctionNodeData).params[p.name] ?? p.default ?? ''"
                @input="updateParam(p.name, Number(($event.target as HTMLInputElement).value))"
                class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
              />
              <input
                v-else-if="p.type === 'boolean'"
                type="checkbox"
                :checked="!!(node.data as FunctionNodeData).params[p.name]"
                @change="updateParam(p.name, ($event.target as HTMLInputElement).checked)"
              />
              <input
                v-else
                type="text"
                :value="(node.data as FunctionNodeData).params[p.name] ?? p.default ?? ''"
                @input="updateParam(p.name, ($event.target as HTMLInputElement).value)"
                class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
              />
              <p v-if="p.description" class="text-xs text-[var(--goa-color-text-secondary)] mt-0.5">{{ p.description }}</p>
            </div>
          </div>
        </div>
      </template>

      <!-- TOOL -->
      <template v-else-if="node.data.kind === 'tool'">
        <div>
          <label class="block text-xs font-medium mb-1">Tool</label>
          <select
            :value="(node.data as ToolNodeData).toolName"
            @change="update('toolName', ($event.target as HTMLSelectElement).value)"
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          >
            <option v-for="t in tools" :key="t.name" :value="t.name">{{ t.category }} · {{ t.name }}</option>
          </select>
          <p v-if="currentToolEntry" class="text-xs text-[var(--goa-color-text-secondary)] mt-1">{{ currentToolEntry.description }}</p>
        </div>

        <div v-if="currentToolEntry">
          <div class="text-xs font-medium mb-1">Parameters</div>
          <div class="space-y-2">
            <div v-for="(prop, key) in (currentToolEntry.parameters.properties as Record<string, { type?: string; description?: string }>)" :key="String(key)">
              <label class="block text-xs font-mono">
                {{ key }}<span v-if="currentToolEntry.parameters.required?.includes(String(key))" class="text-[var(--goa-color-error)]"> *</span>
              </label>
              <input
                v-if="prop.type === 'number'"
                type="number"
                :value="(node.data as ToolNodeData).params[String(key)] ?? ''"
                @input="updateParam(String(key), Number(($event.target as HTMLInputElement).value))"
                class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
              />
              <input
                v-else-if="prop.type === 'boolean'"
                type="checkbox"
                :checked="!!(node.data as ToolNodeData).params[String(key)]"
                @change="updateParam(String(key), ($event.target as HTMLInputElement).checked)"
              />
              <input
                v-else
                type="text"
                :value="(node.data as ToolNodeData).params[String(key)] ?? ''"
                @input="updateParam(String(key), ($event.target as HTMLInputElement).value)"
                placeholder="Use ${nodeId} or ${nodeId.path} to reference upstream values"
                class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
              />
              <p v-if="prop.description" class="text-xs text-[var(--goa-color-text-secondary)] mt-0.5">{{ prop.description }}</p>
            </div>
          </div>
        </div>
      </template>

      <!-- NOTE -->
      <template v-else>
        <div>
          <label class="block text-xs font-medium mb-1">Markdown</label>
          <textarea
            :value="(node.data as NoteNodeData).markdown"
            @input="update('markdown', ($event.target as HTMLTextAreaElement).value)"
            rows="8"
            class="w-full p-2 border border-[var(--goa-color-border)] rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          />
        </div>
      </template>
    </div>
  </aside>
</template>
