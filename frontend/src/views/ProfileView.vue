<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUserMemoryStore } from '@/stores/userMemory'
import { useToast } from '@/composables/useToast'
import { useDocumentTitle } from '@/composables/useDocumentTitle'

useDocumentTitle(() => 'Profile')

const auth = useAuthStore()
const memory = useUserMemoryStore()
const router = useRouter()
const toast = useToast()

const ministryLabel = computed(() => auth.user?.ministryCode ?? 'Not assigned')

onMounted(async () => {
  if (!auth.fetched) {
    await auth.fetchMe()
  }
  await Promise.all([memory.fetchSavedPrompts(), memory.fetchFavoriteWorkflows()])
})

async function handleLogout(): Promise<void> {
  await auth.logout()
  memory.reset()
  await router.push({ name: 'login' })
}

function openFavorite(workflowId: string): void {
  router.push(`/workflows/${workflowId}`)
}

function usePrompt(promptText: string, title: string): void {
  router.push({ name: 'free-agent', query: { prompt: promptText } })
  toast.push({ kind: 'info', message: `Loaded "${title}" into Free Agent.` })
}

function fmt(date: string | null): string {
  if (!date) return ''
  try {
    return new Date(date).toLocaleString()
  } catch {
    return date
  }
}
</script>

<template>
  <section class="max-w-4xl mx-auto p-6 space-y-6">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-[var(--goa-color-primary-dark)]">Profile</h1>
        <p class="text-sm text-[var(--goa-color-text-secondary)] mt-1">
          Your identity, ministry assignment, and saved work.
        </p>
      </div>
      <goa-button type="secondary" @_click="handleLogout">Sign out</goa-button>
    </header>

    <div
      class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md p-5"
    >
      <h2 class="text-lg font-semibold mb-3">Identity</h2>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-[var(--goa-color-text-secondary)]">Name</dt>
          <dd>{{ auth.user?.displayName }}</dd>
        </div>
        <div>
          <dt class="text-[var(--goa-color-text-secondary)]">Email</dt>
          <dd>{{ auth.user?.email }}</dd>
        </div>
        <div>
          <dt class="text-[var(--goa-color-text-secondary)]">Ministry</dt>
          <dd>{{ ministryLabel }}</dd>
        </div>
        <div>
          <dt class="text-[var(--goa-color-text-secondary)]">Role</dt>
          <dd class="capitalize">{{ auth.user?.role }}</dd>
        </div>
      </dl>
    </div>

    <div
      class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md p-5"
    >
      <h2 class="text-lg font-semibold mb-3">Saved prompts</h2>
      <p
        v-if="memory.savedPrompts.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)]"
      >
        No saved prompts yet. From the Free Agent view, write a prompt and click
        <em>Save this prompt</em> to add one.
      </p>
      <ul v-else class="divide-y divide-[var(--goa-color-border)]">
        <li
          v-for="p in memory.savedPrompts"
          :key="p.id"
          class="py-3 flex items-start gap-3"
        >
          <div class="flex-1 min-w-0">
            <h3 class="font-medium truncate">{{ p.title }}</h3>
            <p class="text-sm text-[var(--goa-color-text-secondary)] line-clamp-2">
              {{ p.prompt }}
            </p>
            <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
              Updated {{ fmt(p.updatedAt) }}
            </p>
          </div>
          <div class="flex flex-col gap-1 items-end shrink-0">
            <goa-button
              type="tertiary"
              size="compact"
              @_click="usePrompt(p.prompt, p.title)"
            >
              Use
            </goa-button>
            <goa-button
              type="tertiary"
              variant="destructive"
              size="compact"
              @_click="memory.deletePrompt(p.id)"
            >
              Delete
            </goa-button>
          </div>
        </li>
      </ul>
    </div>

    <div
      class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md p-5"
    >
      <h2 class="text-lg font-semibold mb-3">Favorite workflows</h2>
      <p
        v-if="memory.favoriteWorkflows.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)]"
      >
        No favorited workflows yet.
      </p>
      <ul v-else class="divide-y divide-[var(--goa-color-border)]">
        <li
          v-for="f in memory.favoriteWorkflows"
          :key="f.workflowId"
          class="py-3 flex items-start gap-3"
        >
          <button
            type="button"
            class="flex-1 min-w-0 text-left p-1 -m-1 rounded hover:bg-[var(--goa-color-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
            @click="openFavorite(f.workflowId)"
            :aria-label="`Open ${f.name ?? 'workflow'}`"
          >
            <h3 class="font-medium truncate text-[var(--goa-color-primary)]">
              {{ f.name ?? 'Workflow ' + f.workflowId.slice(0, 8) }}
            </h3>
            <p
              v-if="f.description"
              class="text-sm text-[var(--goa-color-text-secondary)] line-clamp-2"
            >
              {{ f.description }}
            </p>
            <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
              Favorited {{ fmt(f.favoritedAt) }}
            </p>
          </button>
          <goa-button
            type="tertiary"
            variant="destructive"
            size="compact"
            @_click="memory.unfavoriteWorkflow(f.workflowId)"
          >
            Remove
          </goa-button>
        </li>
      </ul>
    </div>

    <goa-callout v-if="memory.error" type="emergency" heading="Couldn't load saved items">
      {{ memory.error }}
    </goa-callout>
  </section>
</template>
