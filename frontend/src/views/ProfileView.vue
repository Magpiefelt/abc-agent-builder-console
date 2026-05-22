<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUserMemoryStore } from '@/stores/userMemory'
import { useToast } from '@/composables/useToast'
import { useDocumentTitle } from '@/composables/useDocumentTitle'
import { api } from '@/lib/api'
import type { MyBudgetStatus } from '@/types/admin'

useDocumentTitle(() => 'Profile')

const auth = useAuthStore()
const memory = useUserMemoryStore()
const router = useRouter()
const toast = useToast()

const ministryLabel = computed(() => auth.user?.ministryCode ?? 'Not assigned')

const budget = ref<MyBudgetStatus | null>(null)
const budgetLoading = ref(false)

async function loadBudget(): Promise<void> {
  budgetLoading.value = true
  try {
    budget.value = await api.users.myBudget()
  } catch {
    // The endpoint already fails open server-side; if even that throws,
    // show a neutral "—" state rather than a scary error.
    budget.value = null
  } finally {
    budgetLoading.value = false
  }
}

const budgetPercent = computed(() => {
  if (!budget.value || !budget.value.enforced || !budget.value.limit) return null
  if (budget.value.limit <= 0) return null
  return Math.min(100, Math.round((budget.value.used / budget.value.limit) * 100))
})

const budgetBadgeType = computed<'emergency' | 'important' | 'success'>(() => {
  const pct = budgetPercent.value
  if (pct === null) return 'success'
  if (pct >= 100) return 'emergency'
  if (pct >= 80) return 'important'
  return 'success'
})

function fmtTokens(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}

onMounted(async () => {
  if (!auth.fetched) {
    await auth.fetchMe()
  }
  await Promise.all([
    memory.fetchSavedPrompts(),
    memory.fetchFavoriteWorkflows(),
    loadBudget(),
  ])
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
</script>

<template>
  <section class="max-w-4xl mx-auto p-6 space-y-6">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-[var(--goa-color-primary-dark)] m-0">Profile</h1>
        <p class="text-sm text-[var(--goa-color-text-secondary)] mt-1 m-0">
          Your identity, ministry assignment, and saved work.
        </p>
      </div>
      <goa-button type="secondary" @_click="handleLogout">Sign out</goa-button>
    </header>

    <!-- Identity: dense definition-list, no per-field cards. -->
    <goa-container type="non-interactive" padding="relaxed" heading="Identity">
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 m-0">
        <div>
          <dt class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Name</dt>
          <dd class="m-0 text-base">{{ auth.user?.displayName }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Email</dt>
          <dd class="m-0 text-base">{{ auth.user?.email }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Ministry</dt>
          <dd class="m-0 text-base">{{ ministryLabel }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-[var(--goa-color-text-secondary)]">Role</dt>
          <dd class="m-0 text-base capitalize">{{ auth.user?.role }}</dd>
        </div>
      </dl>
    </goa-container>

    <!-- Token usage this month (Bot 15). Always visible so users know what
         they're using; the chip + bar disappear when there's no enforced
         limit (i.e. unlimited dev / no global default seeded). -->
    <goa-container
      type="non-interactive"
      padding="relaxed"
      heading="Token usage this month"
      data-testid="budget-panel"
    >
      <div v-if="budgetLoading" class="text-sm text-[var(--goa-color-text-secondary)]">
        Loading usage…
      </div>
      <div v-else-if="!budget" class="text-sm text-[var(--goa-color-text-secondary)]">
        Usage information is unavailable right now.
      </div>
      <div v-else class="flex flex-col gap-3">
        <div class="flex items-baseline justify-between gap-3 flex-wrap">
          <div class="text-sm">
            <span class="font-semibold">{{ fmtTokens(budget.used) }}</span>
            <span class="text-[var(--goa-color-text-secondary)]">
              used of
              {{ budget.enforced ? fmtTokens(budget.limit) + ' tokens' : 'unlimited' }}
            </span>
            <span
              v-if="budget.enforced && budget.scope !== 'global'"
              class="ml-2 text-xs text-[var(--goa-color-text-secondary)]"
            >
              (your {{ budget.scope }} cap)
            </span>
          </div>
          <goa-badge
            v-if="budgetPercent !== null"
            :type="budgetBadgeType"
            :content="`${budgetPercent}%`"
            data-testid="budget-badge"
          ></goa-badge>
        </div>
        <div
          v-if="budget.enforced && budgetPercent !== null"
          class="h-2 rounded bg-[var(--goa-color-greyscale-200)] overflow-hidden"
          role="progressbar"
          :aria-valuenow="budgetPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`Monthly token usage: ${budgetPercent}%`"
        >
          <div
            class="h-full transition-all"
            :style="{
              width: `${budgetPercent}%`,
              backgroundColor:
                budgetBadgeType === 'emergency'
                  ? 'var(--goa-color-status-emergency-default)'
                  : budgetBadgeType === 'important'
                    ? 'var(--goa-color-status-warning-default)'
                    : 'var(--goa-color-status-success-default)',
            }"
          ></div>
        </div>
        <p
          v-if="budget.exceeded"
          class="text-xs text-[var(--goa-color-status-emergency-default)] m-0"
        >
          You've hit your monthly cap. Agent and workflow runs will fail until
          the cap resets on
          {{ budget.periodEnd ? new Date(budget.periodEnd).toLocaleDateString() : 'the 1st' }}
          or an admin raises your limit.
        </p>
        <p
          v-else-if="budget.enforced && budgetPercent !== null && budgetPercent >= 80"
          class="text-xs text-[var(--goa-color-status-warning-dark)] m-0"
        >
          You're approaching your monthly cap. Plan runs accordingly.
        </p>
        <p
          v-else-if="!budget.enforced"
          class="text-xs text-[var(--goa-color-text-secondary)] m-0"
        >
          No monthly token cap is currently enforced for your account.
        </p>
      </div>
    </goa-container>

    <!-- Saved prompts: divided list inside one container, action buttons on the right. -->
    <goa-container type="non-interactive" padding="relaxed" heading="Saved prompts">
      <p
        v-if="memory.savedPrompts.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] m-0"
      >
        No saved prompts yet. From the Free Agent view, write a prompt and choose
        <em>Save this prompt</em> to add one.
      </p>
      <ul v-else class="divide-y divide-[var(--goa-color-border)] m-0 p-0 list-none">
        <li
          v-for="p in memory.savedPrompts"
          :key="p.id"
          class="py-3 flex items-start gap-3"
        >
          <div class="flex-1 min-w-0">
            <h3 class="font-medium truncate text-base m-0">{{ p.title }}</h3>
            <p class="text-sm text-[var(--goa-color-text-secondary)] line-clamp-2 m-0 mt-1">
              {{ p.prompt }}
            </p>
            <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1 m-0">
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
    </goa-container>

    <!-- Favourite workflows: one column of link-buttons, distinctly different from Saved prompts. -->
    <goa-container type="non-interactive" padding="relaxed" heading="Favourite workflows">
      <p
        v-if="memory.favoriteWorkflows.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] m-0"
      >
        No favourited workflows yet. Open a workflow and choose <em>Add to favourites</em> to save it here.
      </p>
      <ul v-else class="divide-y divide-[var(--goa-color-border)] m-0 p-0 list-none">
        <li
          v-for="f in memory.favoriteWorkflows"
          :key="f.workflowId"
          class="py-3 flex items-center gap-3"
        >
          <button
            type="button"
            class="flex-1 min-w-0 text-left p-1 -m-1 rounded hover:bg-[var(--goa-color-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
            @click="openFavorite(f.workflowId)"
            :aria-label="`Open ${f.name ?? 'workflow'}`"
          >
            <h3 class="font-medium truncate text-base m-0 text-[var(--goa-color-primary)]">
              {{ f.name ?? 'Workflow ' + f.workflowId.slice(0, 8) }}
            </h3>
            <p
              v-if="f.description"
              class="text-sm text-[var(--goa-color-text-secondary)] line-clamp-2 m-0 mt-1"
            >
              {{ f.description }}
            </p>
            <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1 m-0">
              Favourited {{ fmt(f.favoritedAt) }}
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
    </goa-container>

    <goa-callout v-if="memory.error" type="emergency" heading="Couldn't load saved items">
      {{ memory.error }}
    </goa-callout>
  </section>
</template>
