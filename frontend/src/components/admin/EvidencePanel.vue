<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import { renderMarkdown } from '@/composables/useMarkdown'
import type {
  EvidenceCollectionDetail,
  EvidenceCollectionSummary,
} from '@/types/admin'

const collections = ref<EvidenceCollectionSummary[]>([])
const loading = ref(false)
const generating = ref(false)
const error = ref<string | null>(null)
const selected = ref<EvidenceCollectionDetail | null>(null)
const loadingSelected = ref(false)

const toast = useToast()

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await api.compliance.list({ limit: 50 })
    collections.value = result.collections
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function generate(): Promise<void> {
  if (generating.value) return
  generating.value = true
  try {
    const result = await api.compliance.generate()
    toast.push({
      kind: 'success',
      message: `Generated evidence snapshot "${result.filename}". Refresh the list to see it.`,
    })
    await load()
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't generate snapshot: ${message}` })
  } finally {
    generating.value = false
  }
}

async function openCollection(row: EvidenceCollectionSummary): Promise<void> {
  loadingSelected.value = true
  try {
    selected.value = await api.compliance.get(row.id)
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't load snapshot: ${message}` })
  } finally {
    loadingSelected.value = false
  }
}

function closeCollection(): void {
  selected.value = null
}

async function copyMarkdown(): Promise<void> {
  if (!selected.value) return
  try {
    await navigator.clipboard.writeText(selected.value.markdown)
    toast.push({ kind: 'success', message: 'Markdown copied to clipboard.' })
  } catch {
    toast.push({ kind: 'error', message: 'Clipboard access denied.' })
  }
}

function downloadMarkdown(): void {
  if (!selected.value) return
  const blob = new Blob([selected.value.markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `evidence_${selected.value.collectedAt.slice(0, 10)}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

const renderedHtml = computed(() => renderMarkdown(selected.value?.markdown))

let loaded = false
onActivated(() => {
  if (!loaded) {
    loaded = true
    load()
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-text-default)]">
          Compliance evidence
        </h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1 max-w-prose">
          Daily SOC2 / ATO posture snapshots. Each pass aggregates audit-log
          totals, PII detections, retention activity, webhook outcomes, the
          live model registry, and a SHA-256 hash of the controls matrix.
          Reviewers can read a snapshot end-to-end instead of grepping
          audit rows. Scheduler runs at the configured hour;
          <strong>Generate now</strong> creates an on-demand snapshot.
        </p>
        <p
          v-if="!loading"
          class="text-xs text-[var(--goa-color-text-secondary)] mt-1"
          aria-live="polite"
        >
          {{ collections.length }}
          {{ collections.length === 1 ? 'snapshot' : 'snapshots' }} on record
        </p>
      </div>
      <div class="flex items-center gap-2">
        <goa-button
          type="secondary"
          size="compact"
          leadingicon="refresh"
          @_click="load"
        >
          Refresh
        </goa-button>
        <goa-button
          type="primary"
          size="compact"
          :disabled="generating || undefined"
          data-testid="generate-evidence"
          @_click="generate"
        >
          {{ generating ? 'Generating…' : 'Generate now' }}
        </goa-button>
      </div>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load evidence collections">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Collected at</th>
          <th>Triggered by</th>
          <th>Source version</th>
          <th class="text-right">Audit rows</th>
          <th class="text-right">PII (30d)</th>
          <th class="text-right">Active models</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="collections.length === 0">
          <td colspan="7" class="text-center">
            No snapshots yet — click <strong>Generate now</strong> to produce one.
          </td>
        </tr>
        <tr v-for="row in collections" :key="row.id" data-testid="evidence-row">
          <td class="whitespace-nowrap font-mono text-xs">
            {{ formatTimestamp(row.collectedAt) }}
          </td>
          <td class="text-xs">
            <span :title="row.triggeredBy">{{ shortId(row.triggeredBy) }}</span>
          </td>
          <td class="text-xs font-mono">v{{ row.sourceVersion }}</td>
          <td class="text-right text-xs">{{ row.auditTotal.toLocaleString() }}</td>
          <td class="text-right text-xs">{{ row.piiTotal.toLocaleString() }}</td>
          <td class="text-right text-xs">{{ row.modelTotalActive }}</td>
          <td class="text-right">
            <goa-button
              type="tertiary"
              size="compact"
              data-testid="view-evidence"
              @_click="openCollection(row)"
            >
              View
            </goa-button>
          </td>
        </tr>
      </tbody>
    </goa-table>

    <goa-modal
      v-if="selected"
      open
      heading="Compliance evidence snapshot"
      role="dialog"
      data-testid="evidence-modal"
      @_close="closeCollection"
    >
      <div class="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt class="font-semibold">Collected at</dt>
          <dd>{{ formatTimestamp(selected.collectedAt) }}</dd>
          <dt class="font-semibold">Period</dt>
          <dd>
            {{ formatTimestamp(selected.periodStart) }} →
            {{ formatTimestamp(selected.periodEnd) }}
          </dd>
          <dt class="font-semibold">Triggered by</dt>
          <dd class="font-mono">{{ selected.triggeredBy }}</dd>
          <dt class="font-semibold">Source version</dt>
          <dd class="font-mono">v{{ selected.sourceVersion }}</dd>
        </dl>
        <div
          v-if="loadingSelected"
          class="text-sm text-[var(--goa-color-text-secondary)]"
        >
          Loading…
        </div>
        <div
          v-else
          class="prose prose-sm max-w-none text-[var(--goa-color-text)] [&_table]:my-2 [&_h1]:mt-2 [&_h2]:mt-4 [&_code]:break-words"
          data-testid="evidence-markdown"
          v-html="renderedHtml"
        ></div>
      </div>
      <div slot="actions" class="flex justify-end gap-2">
        <goa-button type="tertiary" size="compact" @_click="copyMarkdown">
          Copy Markdown
        </goa-button>
        <goa-button type="tertiary" size="compact" @_click="downloadMarkdown">
          Download .md
        </goa-button>
        <goa-button type="primary" size="compact" @_click="closeCollection">
          Close
        </goa-button>
      </div>
    </goa-modal>
  </div>
</template>
