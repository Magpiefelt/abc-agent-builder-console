<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAgentSessionStore, type ArtifactRecord } from '@/stores/agentSession'

const session = useAgentSessionStore()

const knownTypes = ['text', 'file', 'image', 'audio', 'data'] as const
type ArtifactType = (typeof knownTypes)[number]

const activeTypes = ref<Set<ArtifactType>>(new Set())

const filtered = computed<ArtifactRecord[]>(() => {
  if (activeTypes.value.size === 0) return session.artifacts
  return session.artifacts.filter((a) =>
    activeTypes.value.has(a.type as ArtifactType),
  )
})

function toggleType(t: ArtifactType): void {
  const next = new Set(activeTypes.value)
  if (next.has(t)) next.delete(t)
  else next.add(t)
  activeTypes.value = next
}

function typeLabel(t: string): string {
  switch (t) {
    case 'text':
      return 'Text'
    case 'file':
      return 'File'
    case 'image':
      return 'Image'
    case 'audio':
      return 'Audio'
    case 'data':
      return 'Data'
    default:
      return t
  }
}

function typeIcon(t: string): string {
  switch (t) {
    case 'image':
      return '◧'
    case 'audio':
      return '♪'
    case 'data':
      return '⌬'
    case 'file':
      return '⎙'
    default:
      return '¶'
  }
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
</script>

<template>
  <div class="flex flex-col gap-3 h-full min-h-0" aria-label="Artifacts panel">
    <div class="flex flex-wrap gap-1">
      <goa-button
        v-for="t in knownTypes"
        :key="t"
        :type="activeTypes.has(t) ? 'primary' : 'secondary'"
        size="compact"
        @_click="toggleType(t)"
      >
        {{ typeLabel(t) }}
      </goa-button>
    </div>

    <div class="overflow-y-auto flex-1 min-h-0 flex flex-col gap-2">
      <div
        v-if="session.artifacts.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-4 text-center"
      >
        No artifacts yet.
      </div>
      <div
        v-else-if="filtered.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-4 text-center"
      >
        No artifacts match the selected type{{ activeTypes.size === 1 ? '' : 's' }}.
      </div>
      <article
        v-for="(a, idx) in filtered"
        :key="`${a.id ?? 'na'}-${idx}`"
        class="border border-[var(--goa-color-border)] rounded-md p-2 bg-[var(--goa-color-surface)] flex gap-3 items-start"
      >
        <span
          class="shrink-0 w-8 h-8 rounded bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)] flex items-center justify-center text-lg"
          aria-hidden="true"
        >
          {{ typeIcon(a.type) }}
        </span>
        <div class="flex-1 min-w-0">
          <h5 class="text-sm font-medium text-[var(--goa-color-text)] truncate">{{ a.title }}</h5>
          <div class="flex flex-wrap gap-2 text-xs text-[var(--goa-color-text-secondary)] mt-1">
            <span>{{ typeLabel(a.type) }}</span>
            <span v-if="a.mimeType">{{ a.mimeType }}</span>
            <span>{{ sizeLabel(a.size) }}</span>
            <span>iter #{{ a.iteration }}</span>
          </div>
          <p v-if="a.description" class="text-xs text-[var(--goa-color-text-secondary)] mt-1 line-clamp-2">
            {{ a.description }}
          </p>
        </div>
        <goa-badge v-if="a.id" type="midtone" content="Persisted"></goa-badge>
        <goa-badge v-else type="important" content="Transient"></goa-badge>
      </article>
    </div>
  </div>
</template>
