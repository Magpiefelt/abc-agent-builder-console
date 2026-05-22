<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

/**
 * Reusable tag editor for the workflow toolbar (Bot 17, F5).
 *
 * Mirrors the backend's validation rules (`backend/src/routes/workflow.ts`):
 *   - lowercase alphanumeric + '-' + '_'
 *   - 1..32 chars, must start with letter or digit
 *   - max 12 tags
 *
 * The editor normalises on commit (lowercase + trim) so the user can type
 * "Education " and get "education". Duplicate tags are silently rejected to
 * avoid annoying the user when they re-add a tag they already have.
 *
 * Read-only mode renders chips without the remove button or input. Used by
 * the WorkflowListView row cells and the templates gallery.
 */

const props = withDefaults(
  defineProps<{
    tags: string[]
    /** Read-only renders chips without the × button or input. */
    readonly?: boolean
    /** Override the placeholder ("Add tag…"). */
    placeholder?: string
    /** Hide the input even in editable mode (chips only). */
    chipsOnly?: boolean
    /** Disable everything (e.g. during a save). */
    disabled?: boolean
    /** Compact mode (smaller chips, no border around the editor). */
    compact?: boolean
  }>(),
  {
    readonly: false,
    placeholder: 'Add tag…',
    chipsOnly: false,
    disabled: false,
    compact: false,
  },
)

const emit = defineEmits<{
  (e: 'update:tags', tags: string[]): void
}>()

const MAX_LENGTH = 32
const MAX_TAGS = 12
const TAG_RE = /^[a-z0-9][a-z0-9_-]*$/

const draft = ref('')
const error = ref<string | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

const reachedLimit = computed(() => props.tags.length >= MAX_TAGS)

function normalise(raw: string): string {
  return raw.trim().toLowerCase()
}

function validate(tag: string): string | null {
  if (tag.length === 0) return null
  if (tag.length > MAX_LENGTH) return `Tag must be ${MAX_LENGTH} characters or less.`
  if (!TAG_RE.test(tag)) {
    return "Tag may only contain lowercase letters, digits, '-' or '_', and must start with a letter or digit."
  }
  return null
}

function commit(): void {
  const cleaned = normalise(draft.value)
  if (cleaned.length === 0) {
    draft.value = ''
    error.value = null
    return
  }
  const validationError = validate(cleaned)
  if (validationError) {
    error.value = validationError
    return
  }
  if (props.tags.includes(cleaned)) {
    error.value = `"${cleaned}" is already added.`
    return
  }
  if (props.tags.length >= MAX_TAGS) {
    error.value = `Maximum ${MAX_TAGS} tags per workflow.`
    return
  }
  emit('update:tags', [...props.tags, cleaned])
  draft.value = ''
  error.value = null
}

function remove(tag: string): void {
  const next = props.tags.filter((t) => t !== tag)
  emit('update:tags', next)
  error.value = null
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    commit()
    return
  }
  if (event.key === 'Backspace' && draft.value.length === 0 && props.tags.length > 0) {
    event.preventDefault()
    const last = props.tags[props.tags.length - 1]
    remove(last)
    await nextTick()
    inputRef.value?.focus()
  }
}

function onInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  // Strip commas inline so the user can paste "ed, health" and we split.
  if (value.includes(',')) {
    const parts = value.split(',')
    const tail = parts.pop() ?? ''
    for (const part of parts) {
      const cleaned = normalise(part)
      if (cleaned && !validate(cleaned) && !props.tags.includes(cleaned) && props.tags.length < MAX_TAGS) {
        emit('update:tags', [...props.tags, cleaned])
      }
    }
    draft.value = tail.replace(/,/g, '')
    return
  }
  draft.value = value
  error.value = null
}

function onBlur(): void {
  // Commit a pending draft on blur so a half-typed tag isn't silently lost.
  if (draft.value.trim().length > 0) commit()
}
</script>

<template>
  <div
    class="flex flex-col gap-1"
    :class="{
      'p-2 rounded border border-[var(--goa-color-border)] bg-[var(--goa-color-surface)]': !compact,
    }"
  >
    <div class="flex flex-wrap items-center gap-1.5">
      <span
        v-for="tag in tags"
        :key="tag"
        class="inline-flex items-center gap-1 rounded-full bg-[var(--goa-color-interactive-secondary)] text-[var(--goa-color-text-primary)] border border-[var(--goa-color-border)] px-2 py-0.5 text-xs font-medium"
        :class="{ 'px-1.5 text-[10px]': compact }"
        :data-testid="`tag-chip-${tag}`"
      >
        <span class="select-none">#{{ tag }}</span>
        <button
          v-if="!readonly && !disabled"
          type="button"
          class="rounded-full w-4 h-4 inline-flex items-center justify-center text-[var(--goa-color-text-secondary)] hover:bg-[var(--goa-color-interactive-hover)] hover:text-[var(--goa-color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--goa-color-primary)]"
          :aria-label="`Remove tag ${tag}`"
          :data-testid="`tag-remove-${tag}`"
          @click="remove(tag)"
        >
          <span aria-hidden="true">×</span>
        </button>
      </span>

      <input
        v-if="!readonly && !chipsOnly"
        ref="inputRef"
        v-model="draft"
        type="text"
        :placeholder="reachedLimit ? `Max ${MAX_TAGS} tags` : placeholder"
        :aria-label="placeholder"
        :disabled="disabled || reachedLimit || undefined"
        :maxlength="MAX_LENGTH"
        class="flex-1 min-w-[8ch] text-xs px-2 py-0.5 bg-transparent border-none focus:outline-none placeholder:italic placeholder:text-[var(--goa-color-text-secondary)]"
        data-testid="tag-input"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />

      <span
        v-if="readonly && tags.length === 0"
        class="text-xs italic text-[var(--goa-color-text-secondary)]"
      >
        No tags
      </span>
    </div>

    <p
      v-if="error"
      class="text-xs text-[var(--goa-color-status-emergency)]"
      role="alert"
      data-testid="tag-error"
    >
      {{ error }}
    </p>
  </div>
</template>
