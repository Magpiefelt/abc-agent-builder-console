<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/composables/useApiFetch'
import { useWorkflowStore } from '@/stores/workflow'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useDocumentTitle } from '@/composables/useDocumentTitle'
import WorkflowTagsEditor from '@/components/workflow/WorkflowTagsEditor.vue'
import type { WorkflowSummary } from '@/types/workflow'

/**
 * Workflow Templates Gallery (Bot 17, F2).
 *
 * Lists workflows flagged `is_template = true`, ministry-scoped by the
 * backend route's existing ACL. "Use as starting point" delegates to
 * `store.duplicate` which the backend already implements to copy the
 * canvas + tags, strip `is_template`, and re-own the row under the caller.
 *
 * The gallery filters by tag in-memory so users can drill into a category
 * quickly. The empty state guides users toward publishing their own work
 * — the only way today to flag a workflow as a template is via a PUT body
 * (`isTemplate: true`).
 */

useDocumentTitle(() => 'Workflow Templates')

const router = useRouter()
const store = useWorkflowStore()
const auth = useAuthStore()
const toast = useToast()

const templates = ref<WorkflowSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const tagFilter = ref<string>('')
const search = ref('')

async function loadTemplates(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const data = await apiFetch<{ workflows: WorkflowSummary[] }>(
      '/api/workflows?templates=true',
    )
    templates.value = data.workflows
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(loadTemplates)

const visibleTemplates = computed<WorkflowSummary[]>(() => {
  return templates.value.filter((wf) => {
    if (tagFilter.value && !(wf.tags ?? []).includes(tagFilter.value)) {
      return false
    }
    if (search.value) {
      const needle = search.value.toLowerCase()
      const tagText = (wf.tags ?? []).join(' ')
      const haystack = `${wf.name} ${wf.description ?? ''} ${tagText}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
})

const availableTags = computed<string[]>(() => {
  const counts = new Map<string, number>()
  for (const wf of templates.value) {
    for (const t of wf.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
})

const hasActiveFilter = computed(
  () => search.value.length > 0 || tagFilter.value.length > 0,
)

const resultLabel = computed(() => {
  const total = templates.value.length
  const shown = visibleTemplates.value.length
  if (total === 0) return ''
  if (shown === total) return `${total} template${total === 1 ? '' : 's'}`
  return `${shown} of ${total} template${total === 1 ? '' : 's'}`
})

function clearFilters(): void {
  search.value = ''
  tagFilter.value = ''
}

function pickTag(tag: string): void {
  tagFilter.value = tag === tagFilter.value ? '' : tag
}

const usingTemplate = ref<string | null>(null)

async function useAsStartingPoint(wf: WorkflowSummary): Promise<void> {
  if (usingTemplate.value) return
  usingTemplate.value = wf.id
  try {
    const copy = await store.duplicate(wf.id, `${wf.name} (from template)`)
    toast.push({
      kind: 'success',
      message: `Created "${copy.name}" — opening editor.`,
    })
    await router.push(`/workflows/${copy.id}`)
  } catch (e) {
    toast.push({
      kind: 'error',
      message: `Couldn't start from template: ${(e as Error).message}`,
    })
  } finally {
    usingTemplate.value = null
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

const ministryLabel = computed(() => auth.user?.ministryCode ?? null)
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="px-6 py-4 bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]">
      <div class="flex items-center gap-4">
        <router-link
          to="/workflows"
          class="text-xs text-[var(--goa-color-primary)] hover:underline flex items-center gap-1"
        >
          <span aria-hidden="true">←</span> All workflows
        </router-link>
        <h1 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Workflow templates</h1>
        <p v-if="ministryLabel" class="text-xs text-[var(--goa-color-text-secondary)]">
          Curated templates accessible to {{ ministryLabel }}.
        </p>
        <div class="flex-1" />
        <goa-input
          name="search"
          type="search"
          :value="search"
          placeholder="Search templates…"
          width="16rem"
          leadingicon="search"
          @_change="(e: CustomEvent<{ value: string }>) => (search = e.detail.value)"
        ></goa-input>
        <goa-dropdown
          v-if="availableTags.length > 0"
          name="templateTagFilter"
          :value="tagFilter"
          width="11rem"
          aria-label="Filter templates by tag"
          @_change="(e: CustomEvent<{ value: string }>) => (tagFilter = e.detail.value)"
        >
          <goa-dropdown-item value="" label="All tags"></goa-dropdown-item>
          <goa-dropdown-item
            v-for="tag in availableTags"
            :key="tag"
            :value="tag"
            :label="`#${tag}`"
          ></goa-dropdown-item>
        </goa-dropdown>
      </div>
    </header>

    <div class="flex-1 overflow-auto p-6">
      <div v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]">
        Loading templates…
      </div>

      <goa-callout v-else-if="error" type="emergency" heading="Couldn't load templates">
        {{ error }}
      </goa-callout>

      <div
        v-else-if="templates.length === 0"
        class="text-center py-16 max-w-md mx-auto"
        data-testid="empty-state"
      >
        <h2 class="text-lg font-semibold text-[var(--goa-color-text-primary)]">No templates yet</h2>
        <p class="mt-2 text-sm text-[var(--goa-color-text-secondary)]">
          Templates are workflows that have been published for re-use. To make one of your
          workflows available here, open it, expand the toolbar's "Publish as template" menu
          (or PUT <code class="text-xs">{ "isTemplate": true }</code>), and re-save.
        </p>
        <router-link
          to="/workflows"
          class="inline-flex items-center gap-1 mt-4 text-[var(--goa-color-primary)] hover:underline"
        >
          Back to your workflows <span aria-hidden="true">→</span>
        </router-link>
      </div>

      <div
        v-else-if="visibleTemplates.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] text-center py-12 flex flex-col items-center gap-3"
        data-testid="no-match-state"
      >
        <span>No templates match your filters.</span>
        <goa-button type="tertiary" size="compact" @_click="clearFilters">Clear filters</goa-button>
      </div>

      <div v-else>
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs text-[var(--goa-color-text-secondary)]" aria-live="polite">
            {{ resultLabel }}
          </span>
          <goa-button
            v-if="hasActiveFilter"
            type="tertiary"
            size="compact"
            @_click="clearFilters"
          >
            Clear filters
          </goa-button>
        </div>

        <ul
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="template-grid"
        >
          <li
            v-for="wf in visibleTemplates"
            :key="wf.id"
            class="border border-[var(--goa-color-border)] rounded p-4 bg-[var(--goa-color-surface)] flex flex-col gap-3 hover:border-[var(--goa-color-primary)] transition-colors"
            :data-testid="`template-card-${wf.id}`"
          >
            <div>
              <h3 class="font-semibold text-[var(--goa-color-text-default)] truncate">
                {{ wf.name }}
              </h3>
              <p
                v-if="wf.description"
                class="text-xs text-[var(--goa-color-text-secondary)] mt-1 line-clamp-3"
              >
                {{ wf.description }}
              </p>
            </div>

            <div v-if="(wf.tags ?? []).length > 0" class="flex flex-wrap gap-1.5">
              <button
                v-for="tag in wf.tags"
                :key="tag"
                type="button"
                class="text-[10px] px-2 py-0.5 rounded-full border border-[var(--goa-color-border)] bg-[var(--goa-color-interactive-secondary)] hover:border-[var(--goa-color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
                :class="{
                  'border-[var(--goa-color-primary)] bg-[var(--goa-color-interactive-hover)]':
                    tag === tagFilter,
                }"
                :aria-pressed="tag === tagFilter"
                :data-testid="`template-tag-${tag}`"
                @click="pickTag(tag)"
              >
                #{{ tag }}
              </button>
            </div>
            <span
              v-else
              class="text-[10px] italic text-[var(--goa-color-text-secondary)]"
            >
              Untagged
            </span>

            <div class="flex items-center gap-3 text-xs text-[var(--goa-color-text-secondary)] mt-auto">
              <span class="uppercase tracking-wide">{{ wf.classification }}</span>
              <span>v{{ wf.version }}</span>
              <span class="ml-auto">Updated {{ formatDate(wf.updated_at) }}</span>
            </div>

            <goa-button
              type="primary"
              size="compact"
              :disabled="usingTemplate !== null || undefined"
              :data-testid="`use-template-${wf.id}`"
              @_click="useAsStartingPoint(wf)"
            >
              {{ usingTemplate === wf.id ? 'Creating…' : 'Use as starting point' }}
            </goa-button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Tailwind doesn't ship line-clamp out of the box for arbitrary versions;
   fall back to a plain CSS clamp so the card layout stays predictable. */
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
