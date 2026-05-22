<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { api, ApiError } from '@/lib/api'
import { useToast } from '@/composables/useToast'
import type { TokenBudget, BudgetUsageRow, BudgetScopeType } from '@/types/admin'

const budgets = ref<TokenBudget[]>([])
const usage = ref<BudgetUsageRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const saving = ref(false)
const deleting = ref<string | null>(null) // composite key scope:id
const toast = useToast()

const newBudget = ref<{
  scopeType: BudgetScopeType
  scopeId: string
  monthlyLimit: string
  notes: string
}>({
  scopeType: 'user',
  scopeId: '',
  monthlyLimit: '',
  notes: '',
})

const editing = ref<Record<string, { limit: string; notes: string }>>({})

const globalBudget = computed(() =>
  budgets.value.find((b) => b.scopeType === 'global'),
)
const userBudgets = computed(() =>
  budgets.value.filter((b) => b.scopeType === 'user'),
)
const ministryBudgets = computed(() =>
  budgets.value.filter((b) => b.scopeType === 'ministry'),
)

const overBudgetUsers = computed(() => usage.value.filter((u) => u.exceeded))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [budgetsResp, usageResp] = await Promise.all([
      api.admin.listBudgets(),
      api.admin.budgetUsage({ limit: 200 }),
    ])
    budgets.value = budgetsResp.budgets
    usage.value = usageResp.usage
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function isValidNewBudget(): boolean {
  const limit = Number(newBudget.value.monthlyLimit)
  if (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit)) return false
  if (newBudget.value.scopeType !== 'global' && !newBudget.value.scopeId.trim()) return false
  return true
}

async function submitNewBudget(): Promise<void> {
  if (!isValidNewBudget() || saving.value) return
  saving.value = true
  try {
    await api.admin.upsertBudget({
      scope_type: newBudget.value.scopeType,
      scope_id:
        newBudget.value.scopeType === 'global'
          ? 'global'
          : newBudget.value.scopeId.trim(),
      monthly_token_limit: Number(newBudget.value.monthlyLimit),
      notes: newBudget.value.notes.trim() || null,
    })
    toast.push({
      kind: 'success',
      message: `Budget set for ${newBudget.value.scopeType}.`,
    })
    newBudget.value = { scopeType: 'user', scopeId: '', monthlyLimit: '', notes: '' }
    await load()
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't save budget: ${message}` })
  } finally {
    saving.value = false
  }
}

function startEdit(b: TokenBudget): void {
  editing.value[b.id] = {
    limit: String(b.monthlyTokenLimit),
    notes: b.notes ?? '',
  }
}

function cancelEdit(id: string): void {
  delete editing.value[id]
}

async function saveEdit(b: TokenBudget): Promise<void> {
  const edit = editing.value[b.id]
  if (!edit) return
  const limit = Number(edit.limit)
  if (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit)) {
    toast.push({ kind: 'error', message: 'Limit must be a non-negative integer.' })
    return
  }
  saving.value = true
  try {
    await api.admin.upsertBudget({
      scope_type: b.scopeType,
      scope_id: b.scopeId,
      monthly_token_limit: limit,
      notes: edit.notes.trim() || null,
    })
    toast.push({ kind: 'success', message: 'Budget updated.' })
    delete editing.value[b.id]
    await load()
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't update budget: ${message}` })
  } finally {
    saving.value = false
  }
}

async function remove(b: TokenBudget): Promise<void> {
  if (b.scopeType === 'global') return
  const key = `${b.scopeType}:${b.scopeId}`
  deleting.value = key
  try {
    await api.admin.deleteBudget(b.scopeType, b.scopeId)
    budgets.value = budgets.value.filter((x) => x.id !== b.id)
    toast.push({ kind: 'success', message: `Removed ${b.scopeType} budget.` })
  } catch (err) {
    const message = err instanceof ApiError ? err.message : String(err)
    toast.push({ kind: 'error', message: `Couldn't remove budget: ${message}` })
  } finally {
    deleting.value = null
  }
}

function formatTokens(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}

function usagePercent(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null
  return Math.min(100, Math.round((used / limit) * 100))
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
  <div class="flex flex-col gap-5">
    <header class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h3 class="text-xl font-semibold text-[var(--goa-color-text-default)]">
          Token budgets
        </h3>
        <p class="text-xs text-[var(--goa-color-text-secondary)] mt-1 max-w-2xl">
          Monthly LLM-token caps enforced before every agent or workflow call.
          Most-specific wins: <strong>user</strong> overrides
          <strong>ministry</strong> overrides <strong>global</strong>. Usage is
          aggregated from agent iterations + workflow executions for the
          current calendar month (UTC).
        </p>
      </div>
      <goa-button
        type="primary"
        size="compact"
        leadingicon="refresh"
        data-testid="refresh"
        @_click="load"
      >
        Refresh
      </goa-button>
    </header>

    <goa-callout v-if="error" type="emergency" heading="Couldn't load budgets">
      {{ error }}
    </goa-callout>

    <goa-callout
      v-if="overBudgetUsers.length > 0"
      type="important"
      heading="Users over budget this month"
    >
      <ul class="list-disc pl-5">
        <li v-for="u in overBudgetUsers" :key="u.userId">
          <strong>{{ u.userDisplayName || u.userEmail || u.userId.slice(0, 8) + '…' }}</strong>
          ({{ u.ministryCode ?? 'no ministry' }}) —
          {{ formatTokens(u.used) }} used of {{ formatTokens(u.effectiveLimit) }}
        </li>
      </ul>
    </goa-callout>

    <!-- Global default -->
    <section>
      <h4 class="text-sm font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">
        Global default
      </h4>
      <goa-table width="100%" variant="normal" version="2">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Limit (tokens/month)</th>
            <th>Notes</th>
            <th>Updated</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="text-center">Loading…</td>
          </tr>
          <tr v-else-if="!globalBudget">
            <td colspan="5" class="text-center text-[var(--goa-color-text-secondary)]">
              No global default — every user has unlimited tokens. Add one below.
            </td>
          </tr>
          <tr v-else-if="editing[globalBudget.id]">
            <td><strong>global</strong></td>
            <td>
              <input
                v-model="editing[globalBudget.id].limit"
                type="number"
                min="0"
                step="1"
                class="border rounded px-2 py-1 w-40"
                aria-label="Monthly token limit"
              />
            </td>
            <td>
              <input
                v-model="editing[globalBudget.id].notes"
                type="text"
                class="border rounded px-2 py-1 w-full"
                aria-label="Notes"
              />
            </td>
            <td class="text-xs font-mono">{{ globalBudget.updatedAt }}</td>
            <td class="text-right">
              <goa-button
                type="primary"
                size="compact"
                :disabled="saving || undefined"
                @_click="saveEdit(globalBudget)"
              >
                Save
              </goa-button>
              <goa-button
                type="tertiary"
                size="compact"
                @_click="cancelEdit(globalBudget.id)"
              >
                Cancel
              </goa-button>
            </td>
          </tr>
          <tr v-else>
            <td><strong>global</strong></td>
            <td class="font-mono">{{ formatTokens(globalBudget.monthlyTokenLimit) }}</td>
            <td>{{ globalBudget.notes || '—' }}</td>
            <td class="text-xs font-mono">{{ globalBudget.updatedAt }}</td>
            <td class="text-right">
              <goa-button type="secondary" size="compact" @_click="startEdit(globalBudget)">
                Edit
              </goa-button>
              <!-- Global cannot be deleted; only tightened. -->
            </td>
          </tr>
        </tbody>
      </goa-table>
    </section>

    <!-- Ministry-scoped -->
    <section>
      <h4 class="text-sm font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">
        Ministry overrides ({{ ministryBudgets.length }})
      </h4>
      <goa-table width="100%" variant="normal" version="2">
        <thead>
          <tr>
            <th>Ministry</th>
            <th>Limit</th>
            <th>Notes</th>
            <th>Updated</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="ministryBudgets.length === 0">
            <td colspan="5" class="text-center text-[var(--goa-color-text-secondary)]">
              No ministry overrides. All ministries fall back to global.
            </td>
          </tr>
          <tr v-for="b in ministryBudgets" :key="b.id">
            <td class="font-mono">{{ b.scopeId }}</td>
            <td v-if="!editing[b.id]" class="font-mono">{{ formatTokens(b.monthlyTokenLimit) }}</td>
            <td v-else>
              <input
                v-model="editing[b.id].limit"
                type="number"
                min="0"
                step="1"
                class="border rounded px-2 py-1 w-40"
              />
            </td>
            <td v-if="!editing[b.id]">{{ b.notes || '—' }}</td>
            <td v-else>
              <input v-model="editing[b.id].notes" type="text" class="border rounded px-2 py-1 w-full" />
            </td>
            <td class="text-xs font-mono">{{ b.updatedAt }}</td>
            <td class="text-right">
              <template v-if="!editing[b.id]">
                <goa-button type="secondary" size="compact" @_click="startEdit(b)">Edit</goa-button>
                <goa-button
                  type="tertiary"
                  variant="destructive"
                  size="compact"
                  :disabled="deleting === `${b.scopeType}:${b.scopeId}` || undefined"
                  @_click="remove(b)"
                >
                  Remove
                </goa-button>
              </template>
              <template v-else>
                <goa-button
                  type="primary"
                  size="compact"
                  :disabled="saving || undefined"
                  @_click="saveEdit(b)"
                >
                  Save
                </goa-button>
                <goa-button type="tertiary" size="compact" @_click="cancelEdit(b.id)">
                  Cancel
                </goa-button>
              </template>
            </td>
          </tr>
        </tbody>
      </goa-table>
    </section>

    <!-- User-scoped -->
    <section>
      <h4 class="text-sm font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">
        User overrides ({{ userBudgets.length }})
      </h4>
      <goa-table width="100%" variant="normal" version="2">
        <thead>
          <tr>
            <th>User id</th>
            <th>Limit</th>
            <th>This month used</th>
            <th>%</th>
            <th>Notes</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="userBudgets.length === 0">
            <td colspan="6" class="text-center text-[var(--goa-color-text-secondary)]">
              No per-user overrides.
            </td>
          </tr>
          <tr v-for="b in userBudgets" :key="b.id">
            <td class="font-mono text-xs">{{ b.scopeId }}</td>
            <td v-if="!editing[b.id]" class="font-mono">{{ formatTokens(b.monthlyTokenLimit) }}</td>
            <td v-else>
              <input
                v-model="editing[b.id].limit"
                type="number"
                min="0"
                step="1"
                class="border rounded px-2 py-1 w-40"
              />
            </td>
            <td class="font-mono">
              {{ formatTokens(usage.find((u) => u.userId === b.scopeId)?.used ?? 0) }}
            </td>
            <td>
              <span v-if="usagePercent(usage.find((u) => u.userId === b.scopeId)?.used ?? 0, b.monthlyTokenLimit) !== null">
                {{ usagePercent(usage.find((u) => u.userId === b.scopeId)?.used ?? 0, b.monthlyTokenLimit) }}%
              </span>
              <span v-else>—</span>
            </td>
            <td v-if="!editing[b.id]">{{ b.notes || '—' }}</td>
            <td v-else>
              <input v-model="editing[b.id].notes" type="text" class="border rounded px-2 py-1 w-full" />
            </td>
            <td class="text-right">
              <template v-if="!editing[b.id]">
                <goa-button type="secondary" size="compact" @_click="startEdit(b)">Edit</goa-button>
                <goa-button
                  type="tertiary"
                  variant="destructive"
                  size="compact"
                  :disabled="deleting === `${b.scopeType}:${b.scopeId}` || undefined"
                  @_click="remove(b)"
                >
                  Remove
                </goa-button>
              </template>
              <template v-else>
                <goa-button
                  type="primary"
                  size="compact"
                  :disabled="saving || undefined"
                  @_click="saveEdit(b)"
                >
                  Save
                </goa-button>
                <goa-button type="tertiary" size="compact" @_click="cancelEdit(b.id)">
                  Cancel
                </goa-button>
              </template>
            </td>
          </tr>
        </tbody>
      </goa-table>
    </section>

    <!-- Add new -->
    <section class="border-t pt-4 mt-2">
      <h4 class="text-sm font-semibold uppercase tracking-wide text-[var(--goa-color-text-secondary)] mb-2">
        Add new budget
      </h4>
      <form
        class="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
        @submit.prevent="submitNewBudget"
      >
        <label class="text-sm">
          Scope
          <select
            v-model="newBudget.scopeType"
            class="border rounded px-2 py-1 w-full"
            data-testid="scope-type"
          >
            <option value="user">User</option>
            <option value="ministry">Ministry</option>
            <option value="global">Global</option>
          </select>
        </label>
        <label class="text-sm">
          ID
          <input
            v-model="newBudget.scopeId"
            type="text"
            :disabled="newBudget.scopeType === 'global'"
            :placeholder="newBudget.scopeType === 'global' ? 'global (fixed)' : newBudget.scopeType === 'user' ? 'user uuid' : 'ministry code'"
            class="border rounded px-2 py-1 w-full"
            data-testid="scope-id"
          />
        </label>
        <label class="text-sm">
          Tokens / month
          <input
            v-model="newBudget.monthlyLimit"
            type="number"
            min="0"
            step="1"
            class="border rounded px-2 py-1 w-full"
            data-testid="limit"
          />
        </label>
        <label class="text-sm sm:col-span-1">
          Notes (optional)
          <input
            v-model="newBudget.notes"
            type="text"
            class="border rounded px-2 py-1 w-full"
            data-testid="notes"
          />
        </label>
        <div>
          <goa-button
            type="primary"
            size="compact"
            :disabled="!isValidNewBudget() || saving || undefined"
            data-testid="add-budget"
            @_click="submitNewBudget"
          >
            {{ saving ? 'Saving…' : 'Add' }}
          </goa-button>
        </div>
      </form>
    </section>
  </div>
</template>
