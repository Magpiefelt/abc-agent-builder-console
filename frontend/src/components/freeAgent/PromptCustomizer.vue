<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

function computeOverrides(): Record<string, PromptSectionOverride> {
  const overrides: Record<string, PromptSectionOverride> = {}
  for (const s of sections.value) {
    const base = baseSections.value[s.id]
    if (!base) continue
    const diff: PromptSectionOverride = {}
    if (enabledState.value[s.id] !== base.enabled) diff.enabled = enabledState.value[s.id]
    if (contentState.value[s.id] !== base.content) diff.content = contentState.value[s.id]
    if (Object.keys(diff).length > 0) overrides[s.id] = diff
  }
  return overrides
}

function handleSave(): void {
  emit('save', computeOverrides())
}

function handleReset(): void {
  for (const s of sections.value) {
    const base = baseSections.value[s.id]
    if (!base) continue
    enabledState.value[s.id] = base.enabled
    contentState.value[s.id] = base.content
  }
}

const overrideCount = computed(() => {
  let count = 0
  for (const s of sections.value) {
    const base = baseSections.value[s.id]
    if (!base) continue
    if (enabledState.value[s.id] !== base.enabled) count++
    else if (contentState.value[s.id] !== base.content) count++
  }
  return count
})

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    handleSave()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

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
    <div class="flex items-center justify-between mb-3 gap-2">
      <p class="text-xs text-[var(--goa-color-text-secondary)]">
        Toggle sections off or edit their content for this session.
      </p>
      <div class="flex items-center gap-2 shrink-0">
        <goa-badge
          v-if="overrideCount > 0"
          type="information"
          :content="`${overrideCount} change${overrideCount === 1 ? '' : 's'}`"
        ></goa-badge>
        <button
          v-if="overrideCount > 0"
          type="button"
          class="text-xs text-[var(--goa-color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded px-1"
          @click="handleReset"
        >
          Reset
        </button>
      </div>
    </div>

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

    <div slot="actions" class="flex items-center justify-between gap-2 w-full">
      <span class="text-xs text-[var(--goa-color-text-secondary)] hidden sm:inline">
        Tip: ⌘/Ctrl+Enter to save.
      </span>
      <div class="flex gap-2 ml-auto">
        <goa-button type="secondary" @_click="emit('close')">Cancel</goa-button>
        <goa-button type="primary" @_click="handleSave">
          {{ overrideCount > 0 ? `Save ${overrideCount} override${overrideCount === 1 ? '' : 's'}` : 'Save Overrides' }}
        </goa-button>
      </div>
    </div>
  </goa-modal>
</template>
