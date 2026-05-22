<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useUserMemoryStore, type RecentSession } from '@/stores/userMemory'
import { useAgentSessionStore } from '@/stores/agentSession'
import { useDocumentTitle } from '@/composables/useDocumentTitle'

useDocumentTitle(() => 'Session history')

const memory = useUserMemoryStore()
const agentSession = useAgentSessionStore()
const router = useRouter()

const { recentSessions, loading, error, recentStarredOnly } = storeToRefs(memory)
const search = ref('')
const statusFilter = ref<'all' | 'completed' | 'paused' | 'error' | 'needs_assistance'>('all')

// Per-row export state so multiple downloads can be triggered without
// stacking spinners on every row.
const exportingId = ref<string | null>(null)

// Per-row star toggle in-flight state. Prevents double-clicks racing the
// optimistic flip in the store.
const togglingStarId = ref<string | null>(null)

onMounted(() => {
  memory.fetchRecentSessions()
})

async function setStarredOnly(next: boolean): Promise<void> {
  await memory.fetchRecentSessions({ starredOnly: next })
}

async function toggleStar(row: RecentSession): Promise<void> {
  togglingStarId.value = row.id
  try {
    await memory.toggleSessionStar(row.id, !row.starred)
  } finally {
    togglingStarId.value = null
  }
}

const filtered = computed<RecentSession[]>(() => {
  let rows = recentSessions.value
  if (statusFilter.value !== 'all') {
    rows = rows.filter((r) => r.status === statusFilter.value)
  }
  if (search.value.trim().length > 0) {
    const needle = search.value.toLowerCase()
    rows = rows.filter((r) => r.prompt.toLowerCase().includes(needle))
  }
  return rows
})

function fmt(date: string | null): string {
  if (!date) return '—'
  try {
    return new Date(date).toLocaleString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return date
  }
}

function statusBadgeType(status: string): string {
  switch (status) {
    case 'completed':
      return 'success'
    case 'error':
      return 'emergency'
    case 'paused':
      return 'midtone'
    case 'needs_assistance':
      return 'important'
    case 'running':
      return 'information'
    default:
      return 'information'
  }
}

function openReplay(id: string): void {
  router.push({ name: 'session-replay', params: { id } })
}

async function downloadTranscript(id: string): Promise<void> {
  exportingId.value = id
  try {
    await agentSession.exportTranscript(id)
  } finally {
    exportingId.value = null
  }
}

function truncatePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.length <= 140) return trimmed
  return trimmed.slice(0, 137).trimEnd() + '…'
}
</script>

<template>
  <section class="max-w-5xl mx-auto p-6 space-y-4">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-[var(--goa-color-primary-dark)] m-0">
          Session history
        </h1>
        <p class="text-sm text-[var(--goa-color-text-secondary)] mt-1 m-0">
          Re-open a recent Free Agent session, or download a Markdown transcript for a briefing note.
        </p>
      </div>
      <goa-button
        type="secondary"
        size="compact"
        leadingicon="refresh"
        @_click="memory.fetchRecentSessions()"
      >
        Refresh
      </goa-button>
    </header>

    <div class="flex flex-wrap gap-3 items-end">
      <goa-input
        name="search"
        :value="search"
        type="search"
        leadingicon="search"
        placeholder="Search prompt text…"
        width="320px"
        @_change="(e: CustomEvent<{ value: string }>) => (search = e.detail.value)"
      />
      <label class="flex flex-col gap-1 text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
        <span>Status</span>
        <select
          v-model="statusFilter"
          class="border border-[var(--goa-color-border)] rounded-md px-2 py-1 text-sm bg-[var(--goa-color-surface)]"
        >
          <option value="all">All</option>
          <option value="completed">Completed</option>
          <option value="paused">Paused</option>
          <option value="error">Error</option>
          <option value="needs_assistance">Needs assistance</option>
        </select>
      </label>
      <div class="flex items-center pb-1">
        <goa-button
          type="tertiary"
          size="compact"
          :leadingicon="recentStarredOnly ? 'star' : 'star-outline'"
          data-testid="starred-only-toggle"
          :aria-pressed="recentStarredOnly ? 'true' : 'false'"
          @_click="setStarredOnly(!recentStarredOnly)"
        >
          {{ recentStarredOnly ? 'Starred only' : 'Show starred' }}
        </goa-button>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]" role="status">
      Loading recent sessions…
    </div>

    <div
      v-else-if="error"
      class="border border-[var(--goa-color-emergency)] bg-[var(--goa-color-emergency-light)] text-sm rounded-md p-3"
      role="alert"
    >
      Couldn't load recent sessions: {{ error }}
    </div>

    <div
      v-else-if="recentSessions.length === 0"
      class="border border-dashed border-[var(--goa-color-border)] rounded-md p-6 text-sm text-[var(--goa-color-text-secondary)] text-center"
    >
      No recent sessions yet. Run a Free Agent task and it will appear here.
    </div>

    <div
      v-else-if="filtered.length === 0"
      class="border border-dashed border-[var(--goa-color-border)] rounded-md p-6 text-sm text-[var(--goa-color-text-secondary)] text-center"
    >
      No sessions match the current filters.
    </div>

    <ul v-else class="m-0 p-0 list-none space-y-2" aria-label="Recent sessions">
      <li
        v-for="session in filtered"
        :key="session.id"
        class="border border-[var(--goa-color-border)] rounded-md p-3 bg-[var(--goa-color-surface)] flex flex-col gap-2"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <goa-badge :type="statusBadgeType(session.status)" :content="session.status"></goa-badge>
              <span class="text-xs text-[var(--goa-color-text-secondary)]">
                {{ session.modelId }} · {{ session.classification }}
              </span>
            </div>
            <p class="m-0 mt-1 text-sm">{{ truncatePrompt(session.prompt) }}</p>
            <p class="m-0 mt-1 text-xs text-[var(--goa-color-text-secondary)]">
              Started {{ fmt(session.createdAt) }}
              <template v-if="session.completedAt">
                · finished {{ fmt(session.completedAt) }}
              </template>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <goa-button
              type="tertiary"
              size="compact"
              :leadingicon="session.starred ? 'star' : 'star-outline'"
              data-testid="row-star-toggle"
              :aria-pressed="session.starred ? 'true' : 'false'"
              :aria-label="session.starred ? 'Unstar this session' : 'Star this session'"
              :disabled="togglingStarId === session.id"
              @_click="toggleStar(session)"
            >
              {{ session.starred ? 'Starred' : 'Star' }}
            </goa-button>
            <goa-button
              type="tertiary"
              size="compact"
              leadingicon="open"
              @_click="openReplay(session.id)"
            >
              Open
            </goa-button>
            <goa-button
              type="secondary"
              size="compact"
              leadingicon="download"
              :disabled="exportingId === session.id"
              @_click="downloadTranscript(session.id)"
            >
              {{ exportingId === session.id ? 'Exporting…' : 'Download .md' }}
            </goa-button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
