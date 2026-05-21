<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWorkflowStore } from '@/stores/workflow'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const store = useWorkflowStore()
const auth = useAuthStore()
const { list, loading, error } = storeToRefs(store)

const search = ref('')
const ministryFilter = ref<'mine' | 'ministry'>('mine')
const showCreate = ref(false)
const newName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

const deleteTarget = ref<{ id: string; name: string } | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const importError = ref<string | null>(null)

onMounted(() => {
  store.loadList()
})

function triggerImport(): void {
  importError.value = null
  importInput.value?.click()
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset so re-importing the same file fires `change` again.
  input.value = ''
  if (!file) return
  importing.value = true
  importError.value = null
  try {
    const wf = await store.importFromFile(file)
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    importError.value = (e as Error).message
  } finally {
    importing.value = false
  }
}

const filtered = computed(() =>
  list.value.filter((w) => {
    if (search.value && !w.name.toLowerCase().includes(search.value.toLowerCase())) return false
    // The backend list endpoint returns both the user's own workflows AND any
    // workflow inside their ministry. "mine" narrows that down client-side to
    // just the rows owned by the current user; "ministry" keeps everything.
    if (ministryFilter.value === 'mine' && auth.user?.id) {
      if (w.user_id !== auth.user.id) return false
    }
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
  try {
    const wf = await store.duplicate(id)
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    createError.value = (e as Error).message
  }
}

function askDelete(id: string, name: string): void {
  deleteTarget.value = { id, name }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  await store.remove(deleteTarget.value.id)
  deleteTarget.value = null
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
          leadingicon="upload"
          :disabled="importing || undefined"
          @_click="triggerImport"
        >
          {{ importing ? 'Importing…' : 'Import' }}
        </goa-button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          aria-label="Workflow JSON file to import"
          @change="onImportFile"
        />
        <goa-button type="primary" leadingicon="add" @_click="showCreate = !showCreate">
          New workflow
        </goa-button>
      </div>

      <goa-callout
        v-if="importError"
        type="emergency"
        heading="Couldn't import workflow"
        class="mt-2"
      >
        {{ importError }}
      </goa-callout>

      <div v-if="showCreate" class="mt-3 flex items-center gap-2">
        <goa-input
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

      <div v-else-if="filtered.length === 0" class="text-sm text-[var(--goa-color-text-secondary)] text-center py-12">
        No workflows yet. Click "New workflow" to get started.
      </div>

      <goa-table v-else width="100%" variant="normal" version="2">
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
              <goa-button type="tertiary" size="compact" @_click="duplicate(wf.id)">
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
      @_close="deleteTarget = null"
    >
      <p>
        Delete workflow "<strong>{{ deleteTarget.name }}</strong>"? This cannot be undone.
      </p>
      <div slot="actions" class="flex justify-end gap-2">
        <goa-button type="secondary" @_click="deleteTarget = null">Cancel</goa-button>
        <goa-button type="primary" variant="destructive" @_click="confirmDelete">Delete</goa-button>
      </div>
    </goa-modal>
  </div>
</template>
