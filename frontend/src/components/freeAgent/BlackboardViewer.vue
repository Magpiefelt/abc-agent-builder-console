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
      <goa-input
        name="bb-search"
        type="search"
        :value="search"
        placeholder="Search blackboard…"
        leadingicon="search"
        width="100%"
        @_change="(e: CustomEvent<{ value: string }>) => (search = e.detail.value)"
      ></goa-input>
      <div v-if="categories.length > 0" class="flex flex-wrap gap-1">
        <goa-filter-chip
          v-for="c in categories"
          :key="c"
          :content="c"
          :leadingicon="activeCategories.has(c) ? 'checkmark' : undefined"
          @_click="toggleCategory(c)"
        ></goa-filter-chip>
      </div>
    </div>

    <div class="overflow-y-auto flex-1 min-h-0">
      <p
        v-if="session.blackboard.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-4 text-center m-0"
      >
        The agent hasn't written to the blackboard yet. Entries appear as the iteration progresses.
      </p>
      <div
        v-else-if="grouped.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] p-4 text-center flex flex-col gap-2 items-center"
      >
        <span>No entries match your filters.</span>
        <button
          type="button"
          class="text-xs text-[var(--goa-color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded px-1"
          @click="search = ''; activeCategories = new Set()"
        >
          Clear filters
        </button>
      </div>
      <goa-container v-else type="non-interactive" padding="compact">
        <div class="flex flex-col gap-5">
          <section v-for="[cat, entries] in grouped" :key="cat" class="flex flex-col">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-1 m-0">
              {{ cat }}
            </h4>
            <ul class="divide-y divide-[var(--goa-color-border)] m-0 p-0 list-none">
              <li
                v-for="(e, idx) in entries"
                :key="`${cat}-${idx}`"
                class="py-2"
              >
                <header class="flex items-center justify-between gap-2 mb-1">
                  <h5 class="text-sm font-medium text-[var(--goa-color-text-default)] m-0">{{ e.title }}</h5>
                  <goa-badge type="information" :content="`#${e.iteration}`"></goa-badge>
                </header>
                <div class="text-sm prose prose-sm max-w-none" v-html="renderMarkdown(e.content)" />
              </li>
            </ul>
          </section>
        </div>
      </goa-container>
    </div>
  </div>
</template>
