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
      <goa-button
        v-if="node"
        type="tertiary"
        variant="destructive"
        size="compact"
        @_click="emit('remove')"
      >
        Delete node
      </goa-button>
    </div>

    <div v-if="!node" class="flex-1 flex items-center justify-center text-sm text-[var(--goa-color-text-secondary)] p-4 text-center">
      Select a node to edit its properties.
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
      <goa-form-item label="Label">
        <goa-input
          name="label"
          :value="node.data.label"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => update('label', e.detail.value)"
        ></goa-input>
      </goa-form-item>

      <!-- AGENT -->
      <template v-if="node.data.kind === 'agent'">
        <goa-form-item label="Template" :helptext="currentTemplate?.description ?? ''">
          <goa-dropdown
            name="templateId"
            :value="(node.data as AgentNodeData).templateId ?? ''"
            width="100%"
            @_change="(e: CustomEvent<{ value: string }>) => update('templateId', e.detail.value || undefined)"
          >
            <goa-dropdown-item value="" label="(custom)"></goa-dropdown-item>
            <goa-dropdown-item v-for="t in agentTemplates" :key="t.id" :value="t.id" :label="t.name"></goa-dropdown-item>
          </goa-dropdown>
        </goa-form-item>

        <goa-form-item label="Model">
          <goa-dropdown
            name="modelId"
            :value="(node.data as AgentNodeData).modelId"
            width="100%"
            @_change="(e: CustomEvent<{ value: string }>) => update('modelId', e.detail.value)"
          >
            <goa-dropdown-item v-for="m in models" :key="m.id" :value="m.id" :label="m.name"></goa-dropdown-item>
          </goa-dropdown>
        </goa-form-item>

        <goa-form-item label="System Prompt Override">
          <goa-textarea
            name="systemPromptOverride"
            :value="(node.data as AgentNodeData).systemPromptOverride ?? ''"
            rows="6"
            placeholder="Leave empty to use the template's default prompt."
            @_change="(e: CustomEvent<{ value: string }>) => update('systemPromptOverride', e.detail.value || undefined)"
          ></goa-textarea>
        </goa-form-item>

        <div class="grid grid-cols-2 gap-2">
          <goa-form-item label="Temperature">
            <goa-input
              type="number"
              name="temperature"
              step="0.1"
              min="0"
              max="2"
              :value="String((node.data as AgentNodeData).temperature ?? '')"
              width="100%"
              @_change="(e: CustomEvent<{ value: string }>) => update('temperature', Number(e.detail.value) || undefined)"
            ></goa-input>
          </goa-form-item>
          <goa-form-item label="Max Tokens">
            <goa-input
              type="number"
              name="maxTokens"
              min="1"
              :value="String((node.data as AgentNodeData).maxTokens ?? '')"
              width="100%"
              @_change="(e: CustomEvent<{ value: string }>) => update('maxTokens', Number(e.detail.value) || undefined)"
            ></goa-input>
          </goa-form-item>
        </div>
      </template>

      <!-- FUNCTION -->
      <template v-else-if="node.data.kind === 'function'">
        <goa-form-item label="Function" :helptext="currentFunctionEntry?.description ?? ''">
          <goa-dropdown
            name="fnName"
            :value="(node.data as FunctionNodeData).fnName"
            width="100%"
            @_change="(e: CustomEvent<{ value: string }>) => update('fnName', e.detail.value)"
          >
            <goa-dropdown-item
              v-for="f in functionCatalog"
              :key="f.name"
              :value="f.name"
              :label="`${f.category} · ${f.name}`"
            ></goa-dropdown-item>
          </goa-dropdown>
        </goa-form-item>

        <div v-if="currentFunctionEntry && currentFunctionEntry.params.length > 0">
          <div class="text-xs font-medium mb-1">Parameters</div>
          <div class="space-y-2">
            <goa-form-item
              v-for="p in currentFunctionEntry.params"
              :key="p.name"
              :label="p.name"
              :requirement="p.required ? 'required' : 'optional'"
              :helptext="p.description ?? ''"
            >
              <goa-input
                v-if="p.type === 'number'"
                type="number"
                :name="p.name"
                :value="String((node.data as FunctionNodeData).params[p.name] ?? p.default ?? '')"
                width="100%"
                @_change="(e: CustomEvent<{ value: string }>) => updateParam(p.name, Number(e.detail.value))"
              ></goa-input>
              <goa-checkbox
                v-else-if="p.type === 'boolean'"
                :name="p.name"
                :checked="!!(node.data as FunctionNodeData).params[p.name] || undefined"
                @_change="(e: CustomEvent<{ checked: boolean }>) => updateParam(p.name, e.detail.checked)"
              ></goa-checkbox>
              <goa-input
                v-else
                :name="p.name"
                :value="String((node.data as FunctionNodeData).params[p.name] ?? p.default ?? '')"
                width="100%"
                @_change="(e: CustomEvent<{ value: string }>) => updateParam(p.name, e.detail.value)"
              ></goa-input>
            </goa-form-item>
          </div>
        </div>
      </template>

      <!-- TOOL -->
      <template v-else-if="node.data.kind === 'tool'">
        <goa-form-item label="Tool" :helptext="currentToolEntry?.description ?? ''">
          <goa-dropdown
            name="toolName"
            :value="(node.data as ToolNodeData).toolName"
            width="100%"
            @_change="(e: CustomEvent<{ value: string }>) => update('toolName', e.detail.value)"
          >
            <goa-dropdown-item
              v-for="t in tools"
              :key="t.name"
              :value="t.name"
              :label="`${t.category} · ${t.name}`"
            ></goa-dropdown-item>
          </goa-dropdown>
        </goa-form-item>

        <div v-if="currentToolEntry">
          <div class="text-xs font-medium mb-1">Parameters</div>
          <div class="space-y-2">
            <goa-form-item
              v-for="(prop, key) in (currentToolEntry.parameters.properties as Record<string, { type?: string; description?: string }>)"
              :key="String(key)"
              :label="String(key)"
              :requirement="currentToolEntry.parameters.required?.includes(String(key)) ? 'required' : 'optional'"
              :helptext="prop.description ?? ''"
            >
              <goa-input
                v-if="prop.type === 'number'"
                type="number"
                :name="String(key)"
                :value="String((node.data as ToolNodeData).params[String(key)] ?? '')"
                width="100%"
                @_change="(e: CustomEvent<{ value: string }>) => updateParam(String(key), Number(e.detail.value))"
              ></goa-input>
              <goa-checkbox
                v-else-if="prop.type === 'boolean'"
                :name="String(key)"
                :checked="!!(node.data as ToolNodeData).params[String(key)] || undefined"
                @_change="(e: CustomEvent<{ checked: boolean }>) => updateParam(String(key), e.detail.checked)"
              ></goa-checkbox>
              <goa-input
                v-else
                :name="String(key)"
                :value="String((node.data as ToolNodeData).params[String(key)] ?? '')"
                placeholder="Use ${nodeId} or ${nodeId.path} to reference upstream values"
                width="100%"
                @_change="(e: CustomEvent<{ value: string }>) => updateParam(String(key), e.detail.value)"
              ></goa-input>
            </goa-form-item>
          </div>
        </div>
      </template>

      <!-- NOTE -->
      <template v-else>
        <goa-form-item label="Markdown">
          <goa-textarea
            name="markdown"
            :value="(node.data as NoteNodeData).markdown"
            rows="8"
            @_change="(e: CustomEvent<{ value: string }>) => update('markdown', e.detail.value)"
          ></goa-textarea>
        </goa-form-item>
      </template>
    </div>
  </aside>
</template>
