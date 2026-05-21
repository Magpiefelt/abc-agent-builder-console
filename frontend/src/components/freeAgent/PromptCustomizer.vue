<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue'
import type { PromptSectionOverride } from '@/stores/agentSession'

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
const dialogRef = ref<HTMLDivElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(async () => {
  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', onKeydown)
  loading.value = true
  try {
    const res = await fetch('/api/agent/prompt-template')
    if (!res.ok) throw new Error(`Failed to load prompt sections (${res.status})`)
    const data = (await res.json()) as { sections: PromptSection[] }
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
  await nextTick()
  dialogRef.value?.focus()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  previouslyFocused?.focus()
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
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="customizer-title"
  >
    <div
      ref="dialogRef"
      tabindex="-1"
      class="w-full max-w-3xl max-h-[90vh] bg-[var(--goa-color-surface)] rounded-md shadow-lg border border-[var(--goa-color-border)] flex flex-col focus:outline-none"
    >
      <header class="flex items-center justify-between px-4 py-3 border-b border-[var(--goa-color-border)]">
        <div>
          <h3 id="customizer-title" class="text-base font-semibold text-[var(--goa-color-primary-dark)]">
            Customize System Prompt
          </h3>
          <p class="text-xs text-[var(--goa-color-text-secondary)] mt-0.5">
            Toggle sections off or edit their content for this session.
          </p>
        </div>
        <button
          type="button"
          @click="emit('close')"
          aria-label="Close"
          class="text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded p-1"
        >
          <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" fill="none" />
          </svg>
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <p v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]">Loading sections…</p>
        <p v-if="error" class="text-sm text-[var(--goa-color-error)]">{{ error }}</p>

        <article
          v-for="s in sections"
          :key="s.id"
          class="border border-[var(--goa-color-border)] rounded-md"
        >
          <header class="flex items-center gap-3 px-3 py-2">
            <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                v-model="enabledState[s.id]"
                type="checkbox"
                :disabled="s.priority === 1"
                class="accent-[var(--goa-color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
              />
              <span>{{ s.title }}</span>
            </label>
            <span
              class="text-xs px-1.5 py-0.5 rounded bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]"
            >
              {{ priorityLabel(s.priority) }}
            </span>
            <button
              type="button"
              @click="toggle(s.id)"
              :aria-expanded="expanded.has(s.id)"
              :aria-controls="`section-${s.id}`"
              class="ml-auto text-xs font-medium px-2 py-1 border border-[var(--goa-color-border)] rounded hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
            >
              {{ expanded.has(s.id) ? 'Hide' : 'Edit' }}
            </button>
          </header>
          <div
            v-if="expanded.has(s.id)"
            :id="`section-${s.id}`"
            class="px-3 pb-3 pt-1 border-t border-[var(--goa-color-border)]"
          >
            <label :for="`textarea-${s.id}`" class="sr-only">Content for {{ s.title }}</label>
            <textarea
              :id="`textarea-${s.id}`"
              v-model="contentState[s.id]"
              rows="6"
              class="w-full p-2 text-sm font-mono border border-[var(--goa-color-border)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
            />
          </div>
        </article>
      </div>

      <footer class="flex justify-end gap-2 px-4 py-3 border-t border-[var(--goa-color-border)]">
        <button
          type="button"
          @click="emit('close')"
          class="px-3 py-1.5 text-sm border border-[var(--goa-color-border)] rounded-md hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleSave"
          class="px-3 py-1.5 text-sm bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--goa-color-primary)]"
        >
          Save Overrides
        </button>
      </footer>
    </div>
  </div>
</template>
