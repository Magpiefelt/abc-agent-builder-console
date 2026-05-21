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

function reportText(): string {
  return isString.value
    ? (session.finalReport as string)
    : JSON.stringify(session.finalReport, null, 2)
}

async function handleCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(reportText())
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  } catch {
    // clipboard unavailable; silently ignore
  }
}

function handleDownload(): void {
  const text = reportText()
  const ext = isString.value ? 'md' : 'json'
  const mime = isString.value ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.download = `final-report-${stamp}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section
    class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md flex flex-col min-h-0 overflow-hidden"
    aria-label="Final report"
  >
    <header class="px-3 py-2 border-b border-[var(--goa-color-border)] flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-[var(--goa-color-primary-dark)]">Final Report</h3>
      <div class="flex items-center gap-2">
        <goa-button
          type="tertiary"
          size="compact"
          leadingicon="download"
          @_click="handleDownload"
        >
          Download
        </goa-button>
        <goa-button
          type="secondary"
          size="compact"
          leadingicon="copy"
          @_click="handleCopy"
        >
          {{ copyState === 'copied' ? 'Copied!' : 'Copy' }}
        </goa-button>
      </div>
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
