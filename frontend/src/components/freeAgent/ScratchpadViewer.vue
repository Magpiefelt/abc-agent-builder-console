<script setup lang="ts">
import { computed } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'
import { renderMarkdown } from '@/composables/useMarkdown'

const session = useAgentSessionStore()

const rendered = computed(() => renderMarkdown(session.scratchpad))
const attributeEntries = computed(() => Object.entries(session.attributes))
</script>

<template>
  <div class="flex flex-col gap-4 h-full min-h-0 overflow-y-auto" aria-label="Scratchpad viewer">
    <section>
      <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">Scratchpad</h4>
      <div
        v-if="session.scratchpad"
        class="prose prose-sm max-w-none p-3 bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md"
        v-html="rendered"
      />
      <p v-else class="text-sm text-[var(--goa-color-text-secondary)] p-3">
        No scratchpad notes yet.
      </p>
    </section>

    <section>
      <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">Attributes</h4>
      <p v-if="attributeEntries.length === 0" class="text-sm text-[var(--goa-color-text-secondary)] p-3">
        No attributes set.
      </p>
      <dl
        v-else
        class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md divide-y divide-[var(--goa-color-border)]"
      >
        <div v-for="[k, v] in attributeEntries" :key="k" class="flex gap-3 px-3 py-2">
          <dt class="text-xs font-semibold text-[var(--goa-color-text-secondary)] w-1/3 break-words">{{ k }}</dt>
          <dd class="text-sm flex-1 break-words font-mono">{{ typeof v === 'string' ? v : JSON.stringify(v) }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
