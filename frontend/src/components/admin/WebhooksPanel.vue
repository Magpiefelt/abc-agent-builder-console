<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import type {
  WebhookSubscription,
  WebhookEventType,
  WebhookDelivery,
  WebhookDispatchResult,
} from '@/types/admin'

const subscriptions = ref<WebhookSubscription[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const updatingId = ref<string | null>(null)
const testingId = ref<string | null>(null)
const toast = useToast()

// Create/edit modal state.
const showForm = ref(false)
const editingId = ref<string | null>(null)
const formError = ref<string | null>(null)
const saving = ref(false)
const form = ref<{
  eventType: WebhookEventType
  url: string
  secretLabel: string
  enabled: boolean
  description: string
  ministryCode: string
}>({
  eventType: 'session.completed',
  url: '',
  secretLabel: 'primary',
  enabled: true,
  description: '',
  ministryCode: '',
})

// Delete-confirm + deliveries-drilldown state.
const deleteTarget = ref<{ id: string; url: string } | null>(null)
const deleting = ref(false)
const deliveriesFor = ref<{ id: string; url: string } | null>(null)
const deliveries = ref<WebhookDelivery[]>([])
const deliveriesLoading = ref(false)
const deliveriesError = ref<string | null>(null)

const sortedSubscriptions = computed(() =>
  [...subscriptions.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await api.admin.webhooks.list()
    subscriptions.value = result.subscriptions
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function resetForm(): void {
  form.value = {
    eventType: 'session.completed',
    url: '',
    secretLabel: 'primary',
    enabled: true,
    description: '',
    ministryCode: '',
  }
  formError.value = null
}

function openCreate(): void {
  editingId.value = null
  resetForm()
  showForm.value = true
}

function openEdit(sub: WebhookSubscription): void {
  editingId.value = sub.id
  form.value = {
    eventType: sub.eventType,
    url: sub.url,
    secretLabel: sub.secretLabel,
    enabled: sub.enabled,
    description: sub.description ?? '',
    ministryCode: sub.ministryCode ?? '',
  }
  formError.value = null
  showForm.value = true
}

function closeForm(): void {
  if (saving.value) return
  showForm.value = false
}

async function saveForm(): Promise<void> {
  if (!form.value.url.trim() || !form.value.secretLabel.trim()) {
    formError.value = 'URL and secret label are required.'
    return
  }
  saving.value = true
  formError.value = null
  try {
    const body = {
      eventType: form.value.eventType,
      url: form.value.url.trim(),
      secretLabel: form.value.secretLabel.trim(),
      enabled: form.value.enabled,
      description: form.value.description.trim() || null,
      ministryCode: form.value.ministryCode.trim() || null,
    }
    if (editingId.value) {
      const updated = await api.admin.webhooks.update(editingId.value, body)
      const idx = subscriptions.value.findIndex((s) => s.id === updated.id)
      if (idx >= 0) subscriptions.value[idx] = updated
      toast.push({ kind: 'success', message: 'Webhook updated.' })
    } else {
      const created = await api.admin.webhooks.create(body)
      subscriptions.value = [created, ...subscriptions.value]
      toast.push({ kind: 'success', message: 'Webhook created.' })
    }
    showForm.value = false
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(sub: WebhookSubscription): Promise<void> {
  updatingId.value = sub.id
  try {
    const updated = await api.admin.webhooks.update(sub.id, { enabled: !sub.enabled })
    const idx = subscriptions.value.findIndex((s) => s.id === sub.id)
    if (idx >= 0) subscriptions.value[idx] = updated
    toast.push({
      kind: 'success',
      message: `Webhook ${updated.enabled ? 'enabled' : 'disabled'}.`,
    })
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't toggle: ${message}` })
  } finally {
    updatingId.value = null
  }
}

async function sendTest(sub: WebhookSubscription): Promise<void> {
  testingId.value = sub.id
  try {
    const result: WebhookDispatchResult = await api.admin.webhooks.test(sub.id)
    if (result.outcome === 'success') {
      toast.push({
        kind: 'success',
        message: `Test delivered (${result.attempts} attempt${result.attempts === 1 ? '' : 's'}, status ${result.finalStatus}).`,
      })
    } else {
      toast.push({
        kind: 'error',
        message: `Test delivery ${result.outcome} after ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}: ${result.error ?? 'No detail'}`,
      })
    }
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't send test: ${message}` })
  } finally {
    testingId.value = null
  }
}

function askDelete(sub: WebhookSubscription): void {
  deleteTarget.value = { id: sub.id, url: sub.url }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await api.admin.webhooks.remove(deleteTarget.value.id)
    subscriptions.value = subscriptions.value.filter((s) => s.id !== deleteTarget.value!.id)
    toast.push({ kind: 'success', message: 'Webhook deleted.' })
    deleteTarget.value = null
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't delete: ${message}` })
  } finally {
    deleting.value = false
  }
}

async function showDeliveries(sub: WebhookSubscription): Promise<void> {
  deliveriesFor.value = { id: sub.id, url: sub.url }
  deliveriesLoading.value = true
  deliveriesError.value = null
  deliveries.value = []
  try {
    const result = await api.admin.webhooks.deliveries(sub.id, { limit: 50 })
    deliveries.value = result.deliveries
  } catch (err) {
    deliveriesError.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    deliveriesLoading.value = false
  }
}

function closeDeliveries(): void {
  deliveriesFor.value = null
  deliveries.value = []
  deliveriesError.value = null
}

function statusBadgeType(
  status: string | null,
): 'success' | 'emergency' | 'important' | 'midtone' {
  if (!status) return 'midtone'
  if (status === 'success') return 'success'
  if (status === 'client_error') return 'emergency'
  if (status === 'exhausted') return 'important'
  return 'midtone'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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
        <h3 class="text-xl font-semibold text-[var(--goa-color-text-default)]">Webhooks</h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1">
          Subscribe external systems to <code>session.completed</code> and
          <code>workflow.completed</code> events. Each delivery is HMAC-signed
          (<code>X-ABC-Signature: sha256=…</code>) and audited.
        </p>
      </div>
      <div class="flex gap-2">
        <goa-button type="tertiary" size="compact" leadingicon="refresh" @_click="load">
          Refresh
        </goa-button>
        <goa-button
          type="primary"
          size="compact"
          leadingicon="add"
          data-testid="webhooks-new"
          @_click="openCreate"
        >
          New webhook
        </goa-button>
      </div>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load webhooks">
      {{ error }}
    </goa-callout>

    <goa-table width="100%" variant="normal" version="2">
      <thead>
        <tr>
          <th>Event</th>
          <th>URL</th>
          <th>Ministry</th>
          <th>Status</th>
          <th>Last delivery</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="6" class="text-center">Loading…</td>
        </tr>
        <tr v-else-if="sortedSubscriptions.length === 0">
          <td colspan="6" class="text-center text-[var(--goa-color-text-secondary)]">
            No webhook subscriptions yet. Click "New webhook" to create one.
          </td>
        </tr>
        <tr v-for="sub in sortedSubscriptions" :key="sub.id" :data-testid="`webhook-row-${sub.id}`">
          <td>
            <div class="font-medium font-mono text-xs">{{ sub.eventType }}</div>
            <div v-if="sub.description" class="text-xs text-[var(--goa-color-text-secondary)]">
              {{ sub.description }}
            </div>
          </td>
          <td>
            <div class="font-mono text-xs break-all">{{ sub.url }}</div>
            <div class="text-xs text-[var(--goa-color-text-secondary)]">
              label: {{ sub.secretLabel }}
            </div>
          </td>
          <td class="text-xs">{{ sub.ministryCode ?? '— any —' }}</td>
          <td>
            <goa-badge
              :type="sub.enabled ? 'success' : 'midtone'"
              :content="sub.enabled ? 'Enabled' : 'Disabled'"
            ></goa-badge>
          </td>
          <td class="text-xs">
            <div>{{ formatDate(sub.lastDeliveryAt) }}</div>
            <goa-badge
              v-if="sub.lastDeliveryStatus"
              :type="statusBadgeType(sub.lastDeliveryStatus)"
              :content="sub.lastDeliveryStatus"
            ></goa-badge>
          </td>
          <td class="text-right whitespace-nowrap">
            <goa-button
              type="tertiary"
              size="compact"
              :disabled="testingId === sub.id || undefined"
              :data-testid="`webhook-test-${sub.id}`"
              @_click="sendTest(sub)"
            >
              {{ testingId === sub.id ? '…' : 'Send test' }}
            </goa-button>
            <goa-button
              type="tertiary"
              size="compact"
              :data-testid="`webhook-history-${sub.id}`"
              @_click="showDeliveries(sub)"
            >
              History
            </goa-button>
            <goa-button
              :type="sub.enabled ? 'tertiary' : 'secondary'"
              size="compact"
              :disabled="updatingId === sub.id || undefined"
              :data-testid="`webhook-toggle-${sub.id}`"
              @_click="toggleEnabled(sub)"
            >
              {{ sub.enabled ? 'Disable' : 'Enable' }}
            </goa-button>
            <goa-button
              type="tertiary"
              size="compact"
              :data-testid="`webhook-edit-${sub.id}`"
              @_click="openEdit(sub)"
            >
              Edit
            </goa-button>
            <goa-button
              type="tertiary"
              variant="destructive"
              size="compact"
              :data-testid="`webhook-delete-${sub.id}`"
              @_click="askDelete(sub)"
            >
              Delete
            </goa-button>
          </td>
        </tr>
      </tbody>
    </goa-table>

    <!-- Create / edit modal -->
    <goa-modal
      v-if="showForm"
      open
      :heading="editingId ? 'Edit webhook' : 'New webhook'"
      data-testid="webhooks-form-modal"
      @_close="closeForm"
    >
      <div class="flex flex-col gap-3">
        <goa-form-item label="Event">
          <goa-dropdown
            name="eventType"
            :value="form.eventType"
            @_change="(e: CustomEvent<{ value: WebhookEventType }>) => (form.eventType = e.detail.value)"
          >
            <goa-dropdown-item value="session.completed" label="session.completed"></goa-dropdown-item>
            <goa-dropdown-item value="workflow.completed" label="workflow.completed"></goa-dropdown-item>
          </goa-dropdown>
        </goa-form-item>

        <goa-form-item label="URL" helptext="Destination endpoint. Must be HTTPS in production.">
          <goa-input
            name="url"
            :value="form.url"
            width="100%"
            placeholder="https://example.gov.ab.ca/abc-hook"
            @_change="(e: CustomEvent<{ value: string }>) => (form.url = e.detail.value)"
          ></goa-input>
        </goa-form-item>

        <goa-form-item
          label="Secret label"
          helptext="HMAC secret is derived from SECRETS_VAULT_KEY + this label. Rotate by changing the label."
        >
          <goa-input
            name="secretLabel"
            :value="form.secretLabel"
            width="100%"
            placeholder="primary"
            @_change="(e: CustomEvent<{ value: string }>) => (form.secretLabel = e.detail.value)"
          ></goa-input>
        </goa-form-item>

        <goa-form-item label="Ministry filter" helptext="Leave blank to receive events from every ministry.">
          <goa-input
            name="ministryCode"
            :value="form.ministryCode"
            width="100%"
            placeholder="e.g. TBF (or blank for all)"
            @_change="(e: CustomEvent<{ value: string }>) => (form.ministryCode = e.detail.value)"
          ></goa-input>
        </goa-form-item>

        <goa-form-item label="Description (optional)">
          <goa-input
            name="description"
            :value="form.description"
            width="100%"
            @_change="(e: CustomEvent<{ value: string }>) => (form.description = e.detail.value)"
          ></goa-input>
        </goa-form-item>

        <label class="text-sm">
          <input
            type="checkbox"
            :checked="form.enabled"
            @change="form.enabled = ($event.target as HTMLInputElement).checked"
          />
          Enabled
        </label>

        <goa-callout v-if="formError" type="emergency" heading="Couldn't save webhook">
          {{ formError }}
        </goa-callout>
      </div>

      <div slot="actions" class="flex justify-end gap-2">
        <goa-button type="secondary" :disabled="saving || undefined" @_click="closeForm">
          Cancel
        </goa-button>
        <goa-button
          type="primary"
          :disabled="saving || undefined"
          data-testid="webhooks-save"
          @_click="saveForm"
        >
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create' }}
        </goa-button>
      </div>
    </goa-modal>

    <!-- Delete confirm modal -->
    <goa-modal
      v-if="deleteTarget"
      open
      role="alertdialog"
      heading="Delete webhook?"
      data-testid="webhooks-delete-modal"
      @_close="deleting ? null : (deleteTarget = null)"
    >
      <p>
        Delete subscription pointing at <code>{{ deleteTarget.url }}</code>? This
        also removes all stored delivery attempts (audit trail in
        <code>audit_log</code> is preserved).
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
          data-testid="webhooks-delete-confirm"
          @_click="confirmDelete"
        >
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </goa-button>
      </div>
    </goa-modal>

    <!-- Deliveries drilldown modal -->
    <goa-modal
      v-if="deliveriesFor"
      open
      heading="Recent deliveries"
      data-testid="webhooks-deliveries-modal"
      @_close="closeDeliveries"
    >
      <p class="text-xs text-[var(--goa-color-text-secondary)] mb-2">
        Most recent first. Up to 50 attempts shown.
      </p>
      <goa-callout v-if="deliveriesError" type="emergency" heading="Couldn't load deliveries">
        {{ deliveriesError }}
      </goa-callout>
      <div v-else-if="deliveriesLoading" class="text-sm">Loading…</div>
      <goa-table v-else width="100%" variant="normal" version="2">
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Attempt</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="deliveries.length === 0">
            <td colspan="6" class="text-center text-[var(--goa-color-text-secondary)]">
              No deliveries yet.
            </td>
          </tr>
          <tr v-for="d in deliveries" :key="d.id">
            <td class="text-xs">{{ formatDate(d.delivered_at) }}</td>
            <td class="font-mono text-xs">{{ d.event_type }}</td>
            <td class="text-xs">{{ d.attempt }}</td>
            <td class="text-xs">{{ d.response_status ?? '—' }}</td>
            <td class="text-xs">{{ d.duration_ms != null ? `${d.duration_ms} ms` : '—' }}</td>
            <td class="text-xs text-[var(--goa-color-text-secondary)]">
              {{ d.error ?? '' }}
            </td>
          </tr>
        </tbody>
      </goa-table>
      <div slot="actions" class="flex justify-end">
        <goa-button type="secondary" @_click="closeDeliveries">Close</goa-button>
      </div>
    </goa-modal>
  </div>
</template>
