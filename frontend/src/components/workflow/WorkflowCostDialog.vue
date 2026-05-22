<script setup lang="ts">
/**
 * WorkflowCostDialog
 *
 * Pre-run confirmation modal (recommendations §4.3). Shows the workflow's
 * estimated agent call count, token usage, and per-model dollar cost.
 * Surfaces unknown models with a warning row so the user can't assume those
 * agents are free. Both the toolbar Run button and the Ctrl+Enter shortcut
 * route through this dialog via WorkflowView.onRun.
 *
 * Emits `confirm` when the user accepts the estimate, `cancel` otherwise.
 */
import { computed } from 'vue'
import type { WorkflowCostEstimate } from '@/types/workflow'

const props = defineProps<{
  estimate: WorkflowCostEstimate | null
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const totalLabel = computed(() => {
  if (!props.estimate) return ''
  return formatCurrency(props.estimate.total.totalCost, props.estimate.total.currency)
})

const tokensLabel = computed(() => {
  if (!props.estimate) return ''
  const total =
    props.estimate.estimatedInputTokens + props.estimate.estimatedOutputTokens
  return `${formatNumber(total)} tokens (${formatNumber(props.estimate.estimatedInputTokens)} in / ${formatNumber(props.estimate.estimatedOutputTokens)} out)`
})

const callsLabel = computed(() => {
  if (!props.estimate) return ''
  const parts: string[] = []
  parts.push(
    `${props.estimate.agentCallCount} agent ${props.estimate.agentCallCount === 1 ? 'call' : 'calls'}`,
  )
  if (props.estimate.toolCallCount > 0) {
    parts.push(
      `${props.estimate.toolCallCount} tool ${props.estimate.toolCallCount === 1 ? 'call' : 'calls'}`,
    )
  }
  if (props.estimate.functionCallCount > 0) {
    parts.push(
      `${props.estimate.functionCallCount} ${props.estimate.functionCallCount === 1 ? 'function' : 'functions'}`,
    )
  }
  return parts.join(' · ')
})

const hasUnknownModels = computed(
  () => (props.estimate?.unknownModels?.length ?? 0) > 0,
)

const confirmDisabled = computed(() => props.loading || !props.estimate)

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-CA').format(Math.round(n))
}

function formatCurrency(amount: number, currency: string): string {
  // Costs are often <$0.01 for small flows; show 4 decimals for amounts under
  // $1 so the user can see fractional cents, otherwise default to 2 decimals.
  const min = amount < 1 ? 4 : 2
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: min,
    maximumFractionDigits: 4,
  }).format(amount)
}

function formatNodeCost(
  cost: number | null,
  currency: string,
): string {
  if (cost === null) return '—'
  return formatCurrency(cost, currency)
}
</script>

<template>
  <goa-modal
    open
    heading="Workflow cost estimate"
    role="dialog"
    @_close="emit('cancel')"
  >
    <div v-if="loading" class="text-sm text-[var(--goa-color-text-secondary)]" aria-live="polite">
      Estimating workflow cost…
    </div>

    <goa-callout v-else-if="error" type="emergency" heading="Couldn't estimate cost">
      {{ error }}
    </goa-callout>

    <div v-else-if="estimate" data-testid="cost-estimate-body">
      <div class="mb-4">
        <div class="text-2xl font-semibold tabular-nums" data-testid="cost-total">
          ~{{ totalLabel }}
        </div>
        <div class="text-sm text-[var(--goa-color-text-secondary)] mt-1">
          {{ callsLabel }} · {{ tokensLabel }}
        </div>
      </div>

      <div v-if="hasUnknownModels" class="mb-4">
        <goa-callout type="important" heading="Some models don't have a price">
          <p class="text-sm">
            The estimate excludes the cost of agent nodes using:
            <strong>{{ estimate.unknownModels.join(', ') }}</strong
            >. Actual cost will be higher than shown.
          </p>
        </goa-callout>
      </div>

      <div v-if="estimate.perNode.length > 0" class="mb-2">
        <h4 class="text-sm font-semibold mb-2 text-[var(--goa-color-text)]">
          Per-node breakdown
        </h4>
        <ul
          class="border border-[var(--goa-color-border)] rounded divide-y divide-[var(--goa-color-border)]"
          aria-label="Per-node cost breakdown"
          data-testid="per-node-list"
        >
          <li
            v-for="row in estimate.perNode"
            :key="row.nodeId"
            class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <div class="flex flex-col min-w-0">
              <span class="font-medium truncate">{{ row.label }}</span>
              <span class="text-xs text-[var(--goa-color-text-secondary)] truncate">
                {{ row.modelId }} ·
                {{ formatNumber(row.inputTokens) }} in /
                {{ formatNumber(row.outputTokens) }} out
              </span>
            </div>
            <span class="tabular-nums shrink-0" :class="row.isPriced ? '' : 'text-[var(--goa-color-text-secondary)] italic'">
              <template v-if="row.isPriced">
                {{ formatNodeCost((row.inputCost ?? 0) + (row.outputCost ?? 0), estimate.currency) }}
              </template>
              <template v-else>unpriced</template>
            </span>
          </li>
        </ul>
      </div>

      <p class="text-xs text-[var(--goa-color-text-secondary)] mt-3">
        Estimate is approximate (±30%). Assumes all branches execute — actual
        spend may be lower if a Branch function prunes downstream agents.
      </p>
    </div>

    <div slot="actions" class="flex items-center justify-end gap-2 w-full">
      <goa-button type="secondary" @_click="emit('cancel')">Cancel</goa-button>
      <goa-button
        type="primary"
        :disabled="confirmDisabled || undefined"
        @_click="emit('confirm')"
      >
        Confirm and run
      </goa-button>
    </div>
  </goa-modal>
</template>
