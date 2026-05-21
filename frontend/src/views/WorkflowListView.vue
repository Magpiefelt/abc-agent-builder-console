<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'

const router = useRouter()
const store = useWorkflowStore()
const { list, loading, error } = storeToRefs(store)

const search = ref('')
const ministryFilter = ref<'mine' | 'ministry'>('mine')
const showCreate = ref(false)
const newName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

onMounted(() => {
  store.loadList()
})

const filtered = computed(() =>
  list.value.filter((w) => {
    if (search.value && !w.name.toLowerCase().includes(search.value.toLowerCase())) return false
    return true
  })
)

async function createWorkflow(): Promise<void> {
  if (!newName.value.trim()) return
  creating.value = true
  createError.value = null
  try {
    const wf = await store.create(newName.value.trim())
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    createError.value = (e as Error).message
  } finally {
    creating.value = false
  }
}

async function duplicate(id: string): Promise<void> {
  const src = list.value.find((w) => w.id === id)
  if (!src) return
  // Load full canvas, then create new
  await store.load(id)
  const canvas = store.current?.canvas_data
  if (!canvas) return
  const wf = await store.create(`${src.name} (copy)`, src.classification)
  // Update the new workflow with the canvas
  await store.load(wf.id)
  if (store.current) {
    store.setNodes(canvas.nodes)
    store.setEdges(canvas.edges)
    await store.save()
  }
  router.push(`/workflows/${wf.id}`)
}

async function deleteWorkflow(id: string, name: string): Promise<void> {
  if (!window.confirm(`Delete workflow "${name}"? This cannot be undone.`)) return
  await store.remove(id)
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
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="px-6 py-4 bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]">
      <div class="flex items-center gap-4">
        <h1 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Workflows</h1>
        <div class="flex-1" />
        <input
          v-model="search"
          type="search"
          placeholder="Search workflows…"
          class="w-64 p-2 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
        />
        <select
          v-model="ministryFilter"
          class="p-2 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
        >
          <option value="mine">My ministry</option>
          <option value="ministry">All accessible</option>
        </select>
        <button
          @click="showCreate = !showCreate"
          class="text-sm py-2 px-3 bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)]"
        >
          + New workflow
        </button>
      </div>

      <div v-if="showCreate" class="mt-3 flex items-center gap-2">
        <input
          v-model="newName"
          @keyup.enter="createWorkflow"
          type="text"
          placeholder="Workflow name"
          class="flex-1 p-2 text-sm border border-[var(--goa-color-border)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
        />
        <button
          @click="createWorkflow"
          :disabled="!newName.trim() || creating"
          class="text-sm py-2 px-3 bg-[var(--goa-color-primary)] text-white rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-50"
        >
          {{ creating ? 'Creating…' : 'Create' }}
        </button>
        <button
          @click="showCreate = false"
          class="text-sm py-2 px-3 text-[var(--goa-color-text-secondary)] hover:underline"
        >
          Cancel
        </button>
      </div>
      <div v-if="createError" class="mt-2 text-sm text-[var(--goa-color-error)]">{{ createError }}</div>
    </header>

    <div class="flex-1 overflow-auto p-6">
      <div v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]">Loading workflows…</div>

      <div v-else-if="error" class="text-sm text-[var(--goa-color-error)]">{{ error }}</div>

      <div v-else-if="filtered.length === 0" class="text-sm text-[var(--goa-color-text-secondary)] text-center py-12">
        No workflows yet. Click "+ New workflow" to get started.
      </div>

      <table v-else class="w-full bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md overflow-hidden">
        <thead class="bg-[var(--goa-color-primary-light)] text-left text-sm">
          <tr>
            <th class="px-4 py-2 font-semibold">Name</th>
            <th class="px-4 py-2 font-semibold">Classification</th>
            <th class="px-4 py-2 font-semibold">Version</th>
            <th class="px-4 py-2 font-semibold">Updated</th>
            <th class="px-4 py-2 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="text-sm">
          <tr
            v-for="wf in filtered"
            :key="wf.id"
            class="border-t border-[var(--goa-color-border)] hover:bg-[var(--goa-color-primary-light)]/30"
          >
            <td class="px-4 py-2">
              <router-link
                :to="`/workflows/${wf.id}`"
                class="text-[var(--goa-color-primary)] hover:underline font-medium"
              >
                {{ wf.name }}
              </router-link>
              <div v-if="wf.description" class="text-xs text-[var(--goa-color-text-secondary)] truncate">{{ wf.description }}</div>
            </td>
            <td class="px-4 py-2 text-xs uppercase">{{ wf.classification }}</td>
            <td class="px-4 py-2 text-xs">v{{ wf.version }}</td>
            <td class="px-4 py-2 text-xs">{{ formatDate(wf.updated_at) }}</td>
            <td class="px-4 py-2 text-right">
              <button
                @click="duplicate(wf.id)"
                class="text-xs text-[var(--goa-color-primary)] hover:underline mr-3"
              >
                Use as template
              </button>
              <button
                @click="deleteWorkflow(wf.id, wf.name)"
                class="text-xs text-[var(--goa-color-error)] hover:underline"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
