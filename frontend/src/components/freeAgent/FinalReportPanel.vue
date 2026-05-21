<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAgentSessionStore } from '@/stores/agentSession'
import { renderMarkdown } from '@/composables/useMarkdown'

const session = useAgentSessionStore()

const isString = computed(() => typeof session.finalReport === 'string')
const rendered = computed(() =>
  isString.value ? renderMarkdown(session.finalReport as string) : '',
)
const prettyJson = computed(() =>
  isString.value ? '' : JSON.stringify(session.finalReport, null, 2),
)

const copyState = ref<'idle' | 'copied'>('idle')

async function handleCopy(): Promise<void> {
  const text = isString.value
    ? (session.finalReport as string)
    : JSON.stringify(session.finalReport, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  } catch {
    // clipboard unavailable; silently ignore
  }
}
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md flex flex-col min-h-0 overflow-hidden"
    aria-label="Final report"
  >
    <header class="px-3 py-2 border-b border-[var(--goa-color-border)] flex items-center justify-between">
      <h3 class="text-sm font-semibold text-[var(--goa-color-primary-dark)]">Final Report</h3>
      <button
        type="button"
        @click="handleCopy"
        class="text-xs font-medium px-2 py-1 border border-[var(--goa-color-border)] rounded hover:bg-[var(--goa-color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      >
        {{ copyState === 'copied' ? 'Copied!' : 'Copy' }}
      </button>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      <div
        v-if="isString"
        class="prose prose-sm max-w-none"
        v-html="rendered"
      />
      <pre
        v-else
        class="text-xs font-mono whitespace-pre-wrap break-words"
      >{{ prettyJson }}</pre>
    </div>
  </section>
</template>
