<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useDocumentTitle } from '@/composables/useDocumentTitle'

useDocumentTitle(() => 'Workflows')

const router = useRouter()
const store = useWorkflowStore()
const auth = useAuthStore()
const toast = useToast()
const { list, loading, error } = storeToRefs(store)

const search = ref('')
const ministryFilter = ref<'mine' | 'ministry'>('mine')
const showCreate = ref(false)
const newName = ref('')
const newNameInput = ref<HTMLElement | null>(null)
const creating = ref(false)
const createError = ref<string | null>(null)

const deleteTarget = ref<{ id: string; name: string } | null>(null)
const deleting = ref(false)

const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

function triggerImport(): void {
  importInput.value?.click()
}

async function onImportFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset the input so the same filename can be re-selected if needed.
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const wf = await store.importFromFile(file)
    toast.push({ kind: 'success', message: `Imported "${wf.name}".` })
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    toast.push({ kind: 'error', message: `Couldn't import: ${(e as Error).message}` })
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  store.loadList()
})

const filtered = computed(() =>
  list.value.filter((w) => {
    if (
      ministryFilter.value === 'mine' &&
      auth.user?.ministryCode &&
      w.ministry_code !== auth.user.ministryCode
    ) {
      return false
    }
    if (search.value) {
      const needle = search.value.toLowerCase()
      const haystack = `${w.name} ${w.description ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
)

const hasActiveFilter = computed(
  () => search.value.length > 0 || ministryFilter.value !== 'mine',
)

const resultLabel = computed(() => {
  const total = list.value.length
  const shown = filtered.value.length
  if (total === 0) return ''
  if (shown === total) return `${total} workflow${total === 1 ? '' : 's'}`
  return `${shown} of ${total} workflow${total === 1 ? '' : 's'}`
})

async function toggleCreate(): Promise<void> {
  showCreate.value = !showCreate.value
  if (showCreate.value) {
    createError.value = null
    await nextTick()
    // goa-input is a web component — focus its inner input.
    const host = newNameInput.value as (HTMLElement & { focus?: () => void }) | null
    if (host) {
      const inner = host.shadowRoot?.querySelector('input') as HTMLInputElement | null
      if (inner) inner.focus()
      else host.focus?.()
    }
  }
}

function clearFilters(): void {
  search.value = ''
  ministryFilter.value = 'mine'
}

async function createWorkflow(): Promise<void> {
  if (!newName.value.trim()) return
  creating.value = true
  createError.value = null
  try {
    const wf = await store.create(newName.value.trim())
    toast.push({ kind: 'success', message: `Workflow "${wf.name}" created.` })
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    createError.value = (e as Error).message
  } finally {
    creating.value = false
  }
}

async function duplicate(id: string, name: string): Promise<void> {
  try {
    const wf = await store.duplicate(id)
    toast.push({ kind: 'success', message: `Duplicated "${name}" as "${wf.name}".` })
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    createError.value = (e as Error).message
  }
}

function askDelete(id: string, name: string): void {
  deleteTarget.value = { id, name }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value || deleting.value) return
  const { id, name } = deleteTarget.value
  deleting.value = true
  try {
    await store.remove(id)
    toast.push({ kind: 'success', message: `Workflow "${name}" deleted.` })
    deleteTarget.value = null
  } catch (e) {
    toast.push({ kind: 'error', message: `Couldn't delete: ${(e as Error).message}` })
  } finally {
    deleting.value = false
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
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="px-6 py-4 bg-[var(--goa-color-surface)] border-b border-[var(--goa-color-border)]">
      <div class="flex items-center gap-4">
        <h1 class="text-xl font-semibold text-[var(--goa-color-primary-dark)]">Workflows</h1>
        <div class="flex-1" />
        <goa-input
          name="search"
          type="search"
          :value="search"
          placeholder="Search workflows…"
          width="16rem"
          leadingicon="search"
          @_change="(e: CustomEvent<{ value: string }>) => (search = e.detail.value)"
        ></goa-input>
        <goa-dropdown
          name="ministryFilter"
          :value="ministryFilter"
          width="12rem"
          @_change="(e: CustomEvent<{ value: 'mine' | 'ministry' }>) => (ministryFilter = e.detail.value)"
        >
          <goa-dropdown-item value="mine" label="My ministry"></goa-dropdown-item>
          <goa-dropdown-item value="ministry" label="All accessible"></goa-dropdown-item>
        </goa-dropdown>
        <goa-button
          type="tertiary"
          leadingicon="cloud-upload"
          :disabled="importing || undefined"
          @_click="triggerImport"
        >
          {{ importing ? 'Importing…' : 'Import JSON' }}
        </goa-button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          class="sr-only"
          aria-label="Workflow JSON file to import"
          @change="onImportFileChosen"
        />
        <goa-button type="primary" leadingicon="add" @_click="toggleCreate">
          New workflow
        </goa-button>
      </div>

      <div v-if="showCreate" class="mt-3 flex items-center gap-2">
        <goa-input
          ref="newNameInput"
          name="newName"
          :value="newName"
          placeholder="Workflow name"
          width="100%"
          @_change="(e: CustomEvent<{ value: string }>) => (newName = e.detail.value)"
          @_keypress="(e: CustomEvent<{ key: string }>) => e.detail.key === 'Enter' && createWorkflow()"
        ></goa-input>
        <goa-button
          type="primary"
          :disabled="!newName.trim() || creating || undefined"
          @_click="createWorkflow"
        >
          {{ creating ? 'Creating…' : 'Create' }}
        </goa-button>
        <goa-button type="tertiary" @_click="showCreate = false">Cancel</goa-button>
      </div>
      <goa-callout
        v-if="createError"
        type="emergency"
        heading="Couldn't create workflow"
        class="mt-2"
      >
        {{ createError }}
      </goa-callout>
    </header>

    <div class="flex-1 overflow-auto p-6">
      <div v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]">Loading workflows…</div>

      <goa-callout v-else-if="error" type="emergency" heading="Couldn't load workflows">
        {{ error }}
      </goa-callout>

      <div v-else-if="filtered.length === 0 && list.length === 0" class="text-sm text-[var(--goa-color-text-secondary)] text-center py-12">
        No workflows yet. Click "New workflow" to get started.
      </div>

      <div
        v-else-if="filtered.length === 0"
        class="text-sm text-[var(--goa-color-text-secondary)] text-center py-12 flex flex-col items-center gap-3"
      >
        <span>No workflows match your filters.</span>
        <goa-button type="tertiary" size="compact" @_click="clearFilters">Clear filters</goa-button>
      </div>

      <div v-else class="flex items-center justify-between mb-3">
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

      <goa-table v-if="filtered.length > 0" width="100%" variant="normal" version="2">
        <thead>
          <tr>
            <th>Name</th>
            <th>Classification</th>
            <th>Version</th>
            <th>Updated</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="wf in filtered" :key="wf.id">
            <td>
              <router-link
                :to="`/workflows/${wf.id}`"
                class="text-[var(--goa-color-primary)] hover:underline font-medium"
              >
                {{ wf.name }}
              </router-link>
              <div v-if="wf.description" class="text-xs text-[var(--goa-color-text-secondary)] truncate">{{ wf.description }}</div>
            </td>
            <td class="text-xs uppercase">{{ wf.classification }}</td>
            <td class="text-xs">v{{ wf.version }}</td>
            <td class="text-xs">{{ formatDate(wf.updated_at) }}</td>
            <td class="text-right">
              <goa-button type="tertiary" size="compact" @_click="duplicate(wf.id, wf.name)">
                Use as template
              </goa-button>
              <goa-button
                type="tertiary"
                variant="destructive"
                size="compact"
                @_click="askDelete(wf.id, wf.name)"
              >
                Delete
              </goa-button>
            </td>
          </tr>
        </tbody>
      </goa-table>
    </div>

    <goa-modal
      v-if="deleteTarget"
      open
      heading="Delete workflow?"
      role="alertdialog"
      @_close="deleting ? null : (deleteTarget = null)"
    >
      <p>
        Delete workflow "<strong>{{ deleteTarget.name }}</strong>"? This cannot be undone.
      </p>
      <div slot="actions" class="flex justify-end gap-2">
        <goa-button
          type="secondary"
          :disabled="deleting || undefined"
          @_click="deleteTarget = null"
        >
          Cancel
        </goa-button>
        <goa-button
          type="primary"
          variant="destructive"
          :disabled="deleting || undefined"
          @_click="confirmDelete"
        >
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </goa-button>
      </div>
    </goa-modal>
  </div>
</template>
