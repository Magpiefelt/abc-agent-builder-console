<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PromptSectionOverride } from '@/stores/agentSession'
import { apiFetch } from '@/composables/useApiFetch'

interface PromptSection {
  id: string
  title: string
  enabled: boolean
  content: string
  priority?: number
}

const props = defineProps<{ initialOverrides: Record<string, PromptSectionOverride> }>()
const emit = defineEmits<{
  save: [overrides: Record<string, PromptSectionOverride>]
  close: []
}>()

const sections = ref<PromptSection[]>([])
const expanded = ref<Set<string>>(new Set())
const enabledState = ref<Record<string, boolean>>({})
const contentState = ref<Record<string, string>>({})
const baseSections = ref<Record<string, PromptSection>>({})
const loading = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  loading.value = true
  try {
    const data = await apiFetch<{ sections: PromptSection[] }>('/api/agent/prompt-template')
    sections.value = data.sections ?? []
    for (const s of sections.value) {
      baseSections.value[s.id] = s
      const override = props.initialOverrides[s.id]
      enabledState.value[s.id] = override?.enabled ?? s.enabled
      contentState.value[s.id] = override?.content ?? s.content
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

function toggle(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function handleSave(): void {
  const overrides: Record<string, PromptSectionOverride> = {}
  for (const s of sections.value) {
    const base = baseSections.value[s.id]
    if (!base) continue
    const diff: PromptSectionOverride = {}
    if (enabledState.value[s.id] !== base.enabled) diff.enabled = enabledState.value[s.id]
    if (contentState.value[s.id] !== base.content) diff.content = contentState.value[s.id]
    if (Object.keys(diff).length > 0) overrides[s.id] = diff
  }
  emit('save', overrides)
}

function priorityLabel(p?: number): string {
  switch (p) {
    case 1:
      return 'Critical'
    case 2:
      return 'High'
    case 3:
      return 'Normal'
    case 4:
      return 'Optional'
    default:
      return 'Normal'
  }
}
</script>

<template>
  <goa-modal
    open
    size="large"
    heading="Customize System Prompt"
    role="dialog"
    @_close="emit('close')"
  >
    <p class="text-xs text-[var(--goa-color-text-secondary)] mb-3">
      Toggle sections off or edit their content for this session.
    </p>

    <p v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]">Loading sections…</p>
    <goa-callout v-if="error" type="emergency" heading="Couldn't load sections">{{ error }}</goa-callout>

    <article
      v-for="s in sections"
      :key="s.id"
      class="border border-[var(--goa-color-border)] rounded-md mb-2"
    >
      <header class="flex items-center gap-3 px-3 py-2">
        <goa-checkbox
          :name="`enabled-${s.id}`"
          :checked="enabledState[s.id] || undefined"
          :disabled="s.priority === 1 || undefined"
          :text="s.title"
          @_change="(e: CustomEvent<{ checked: boolean }>) => (enabledState[s.id] = e.detail.checked)"
        ></goa-checkbox>
        <goa-badge type="information" :content="priorityLabel(s.priority)"></goa-badge>
        <goa-button
          type="tertiary"
          size="compact"
          class="ml-auto"
          @_click="toggle(s.id)"
        >
          {{ expanded.has(s.id) ? 'Hide' : 'Edit' }}
        </goa-button>
      </header>
      <div
        v-if="expanded.has(s.id)"
        :id="`section-${s.id}`"
        class="px-3 pb-3 pt-1 border-t border-[var(--goa-color-border)]"
      >
        <goa-textarea
          :name="`textarea-${s.id}`"
          :value="contentState[s.id]"
          rows="6"
          @_change="(e: CustomEvent<{ value: string }>) => (contentState[s.id] = e.detail.value)"
        ></goa-textarea>
      </div>
    </article>

    <div slot="actions" class="flex justify-end gap-2">
      <goa-button type="secondary" @_click="emit('close')">Cancel</goa-button>
      <goa-button type="primary" @_click="handleSave">Save Overrides</goa-button>
    </div>
  </goa-modal>
</template>
