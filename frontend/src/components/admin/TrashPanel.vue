<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import type { WorkflowTrashEntry } from '@/types/admin'

const items = ref<WorkflowTrashEntry[]>([])
const retentionDays = ref<number | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const restoringId = ref<string | null>(null)
const purgeTarget = ref<WorkflowTrashEntry | null>(null)
const purging = ref(false)
const toast = useToast()

const expiringSoonCount = computed(() => {
  const now = Date.now()
  const threshold = now + 7 * 24 * 60 * 60 * 1000
  return items.value.filter((w) => {
    const t = Date.parse(w.expiresAt)
    return Number.isFinite(t) && t <= threshold
  }).length
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await api.admin.workflowTrash()
    items.value = result.workflows
    retentionDays.value = result.retentionDays
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function restore(item: WorkflowTrashEntry): Promise<void> {
  restoringId.value = item.id
  try {
    await api.admin.restoreWorkflow(item.id)
    items.value = items.value.filter((w) => w.id !== item.id)
    toast.push({
      kind: 'success',
      message: `Restored "${item.name}". Owner can find it in their workflows again.`,
    })
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't restore "${item.name}": ${message}` })
  } finally {
    restoringId.value = null
  }
}

function askPurge(item: WorkflowTrashEntry): void {
  purgeTarget.value = item
}

async function confirmPurge(): Promise<void> {
  if (!purgeTarget.value || purging.value) return
  const target = purgeTarget.value
  purging.value = true
  try {
    await api.admin.purgeWorkflow(target.id)
    items.value = items.value.filter((w) => w.id !== target.id)
    toast.push({
      kind: 'success',
      message: `Purged "${target.name}" permanently. Cascades cleared.`,
    })
    purgeTarget.value = null
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't purge "${target.name}": ${message}` })
  } finally {
    purging.value = false
  }
}

function daysUntil(iso: string): number {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return Number.NaN
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000))
}

function expiryBadgeType(iso: string): 'emergency' | 'important' | 'success' {
  const d = daysUntil(iso)
  if (Number.isNaN(d)) return 'success'
  if (d <= 0) return 'emergency'
  if (d <= 7) return 'important'
  return 'success'
}

function expiryLabel(iso: string): string {
  const d = daysUntil(iso)
  if (Number.isNaN(d)) return '—'
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d === 1) return '1 day'
  return `${d} days`
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

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
          Deleted workflows (Trash)
        </h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Workflows users have deleted. They stay here for
          <strong>{{ retentionDays ?? '—' }} days</strong>
          before the retention job permanently removes them. Restore puts a
          workflow back exactly where its owner left it; Purge wipes it now.
        </p>
        <p
          v-if="!loading"
          class="text-xs text-[var(--goa-color-text-secondary)] mt-1"
          aria-live="polite"
        >
          {{ items.length }} {{ items.length === 1 ? 'workflow' : 'workflows' }} in trash
          <span v-if="expiringSoonCount > 0">
            ·
            <span class="text-[var(--goa-color-status-warning-dark)]">
              {{ expiringSoonCount }} expiring within 7 days
            </span>
          </span>
        </p>
      </div>
      <goa-button type="primary" size="compact" leadingicon="refresh" @_click="load">
        Refresh
      </goa-button>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load trash">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Workflow</th>
          <th>Owner</th>
          <th>Ministry</th>
          <th>Classification</th>
          <th>Deleted</th>
          <th>Expires in</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="items.length === 0">
          <td colspan="7" class="text-center">Trash is empty.</td>
        </tr>
        <tr v-for="item in items" :key="item.id">
          <td>
            <div class="font-medium">{{ item.name }}</div>
            <div
              v-if="item.description"
              class="text-xs text-[var(--goa-color-text-secondary)] truncate max-w-[24rem]"
            >
              {{ item.description }}
            </div>
            <div class="font-mono text-xs text-[var(--goa-color-text-secondary)]">
              {{ item.id.slice(0, 8) }}… · v{{ item.version }}
            </div>
          </td>
          <td class="text-xs">
            {{ item.userDisplayName || item.userEmail || item.userId.slice(0, 8) + '…' }}
          </td>
          <td class="text-xs">{{ item.ministryCode ?? '—' }}</td>
          <td class="text-xs uppercase">{{ item.classification }}</td>
          <td class="whitespace-nowrap font-mono text-xs">
            {{ formatTimestamp(item.deletedAt) }}
          </td>
          <td>
            <goa-badge
              :type="expiryBadgeType(item.expiresAt)"
              :content="expiryLabel(item.expiresAt)"
            ></goa-badge>
          </td>
          <td class="text-right">
            <goa-button
              type="secondary"
              size="compact"
              :disabled="restoringId === item.id || undefined"
              @_click="restore(item)"
            >
              {{ restoringId === item.id ? '…' : 'Restore' }}
            </goa-button>
            <goa-button
              type="tertiary"
              variant="destructive"
              size="compact"
              @_click="askPurge(item)"
            >
              Purge
            </goa-button>
          </td>
        </tr>
      </tbody>
    </goa-table>

    <goa-modal
      v-if="purgeTarget"
      open
      heading="Purge workflow permanently?"
      role="alertdialog"
      @_close="purging ? null : (purgeTarget = null)"
    >
      <p>
        Permanently delete workflow
        "<strong>{{ purgeTarget.name }}</strong>"? This wipes its version
        history, execution log, and any artifacts those runs produced.
        <strong>This cannot be undone.</strong>
      </p>
      <div slot="actions" class="flex justify-end gap-2">
        <goa-button
          type="secondary"
          :disabled="purging || undefined"
          @_click="purgeTarget = null"
        >
          Cancel
        </goa-button>
        <goa-button
          type="primary"
          variant="destructive"
          :disabled="purging || undefined"
          @_click="confirmPurge"
        >
          {{ purging ? 'Purging…' : 'Purge permanently' }}
        </goa-button>
      </div>
    </goa-modal>
  </div>
</template>
