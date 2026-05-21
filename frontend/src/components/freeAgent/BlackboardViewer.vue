<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAgentSessionStore, type BlackboardEntry } from '@/stores/agentSession'
import { renderMarkdown } from '@/composables/useMarkdown'

const session = useAgentSessionStore()

const search = ref('')
const activeCategories = ref<Set<string>>(new Set())

const categories = computed(() => {
  const seen = new Set<string>()
  for (const e of session.blackboard) seen.add(e.category)
  return Array.from(seen).sort()
})

const filtered = computed<BlackboardEntry[]>(() => {
  const term = search.value.trim().toLowerCase()
  return session.blackboard.filter((e) => {
    if (activeCategories.value.size > 0 && !activeCategories.value.has(e.category)) return false
    if (!term) return true
    return (
      e.title.toLowerCase().includes(term) ||
      e.content.toLowerCase().includes(term) ||
      e.category.toLowerCase().includes(term)
    )
  })
})

const grouped = computed(() => {
  const map = new Map<string, BlackboardEntry[]>()
  for (const e of filtered.value) {
    if (!map.has(e.category)) map.set(e.category, [])
    map.get(e.category)!.push(e)
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
})

function toggleCategory(c: string): void {
  const next = new Set(activeCategories.value)
  if (next.has(c)) next.delete(c)
  else next.add(c)
  activeCategories.value = next
}
</script>

<template>
  <div class="flex flex-col gap-3 h-full min-h-0" aria-label="Blackboard viewer">
    <div class="flex flex-col gap-2">
      <label for="bb-search" class="sr-only">Search blackboard</label>
      <input
        id="bb-search"
        v-model="search"
        type="search"
        placeholder="Search blackboard…"
        class="w-full p-2 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      />
      <div v-if="categories.length > 0" class="flex flex-wrap gap-1">
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          @click="toggleCategory(c)"
          :aria-pressed="activeCategories.has(c)"
          :class="[
            'px-2 py-0.5 rounded-full text-xs font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]',
            activeCategories.has(c)
              ? 'bg-[var(--goa-color-primary)] text-white border-[var(--goa-color-primary)]'
              : 'bg-[var(--goa-color-surface)] text-[var(--goa-color-text)] border-[var(--goa-color-border)]',
          ]"
        >
          {{ c }}
        </button>
      </div>
    </div>

    <div class="overflow-y-auto flex-1 min-h-0 flex flex-col gap-3">
      <div
        v-if="session.blackboard.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-4 text-center"
      >
        Blackboard is empty.
      </div>
      <div v-for="[cat, entries] in grouped" :key="cat" class="flex flex-col gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)]">
          {{ cat }}
        </h4>
        <article
          v-for="(e, idx) in entries"
          :key="`${cat}-${idx}`"
          class="border border-[var(--goa-color-border)] rounded-md p-2 bg-[var(--goa-color-surface)]"
        >
          <header class="flex items-center justify-between gap-2 mb-1">
            <h5 class="text-sm font-medium text-[var(--goa-color-text)]">{{ e.title }}</h5>
            <span
              class="text-xs px-1.5 py-0.5 rounded bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]"
              :aria-label="`Iteration ${e.iteration}`"
            >
              #{{ e.iteration }}
            </span>
          </header>
          <div class="text-sm prose prose-sm max-w-none" v-html="renderMarkdown(e.content)" />
        </article>
      </div>
    </div>
  </div>
</template>
