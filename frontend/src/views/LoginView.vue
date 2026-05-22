<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDocumentTitle } from '@/composables/useDocumentTitle'

useDocumentTitle(() => 'Sign in')

const auth = useAuthStore()
const route = useRoute()

const errorMessage = computed(() => {
  const queryError = route.query.error
  if (typeof queryError === 'string' && queryError.length > 0) {
    return decodeURIComponent(queryError)
  }
  return auth.error
})

const returnTo = computed(() => {
  const r = route.query.returnTo
  return typeof r === 'string' && r.startsWith('/') ? r : '/'
})

const hasReturnTo = computed(() => returnTo.value !== '/')

onMounted(() => {
  if (!auth.fetched && !auth.loading) {
    void auth.fetchMe()
  }
})

function signIn(): void {
  auth.login(returnTo.value)
}
</script>

<template>
  <section
    class="min-h-full p-6 sm:p-12 bg-[var(--goa-color-background)]"
    aria-label="Sign in"
  >
    <div class="max-w-5xl mx-auto grid gap-8 md:grid-cols-2 md:items-start">
      <!-- Left column: the sign-in container. The primary action lives here. -->
      <goa-container type="non-interactive" padding="relaxed" heading="Sign in to continue">
        <p class="text-base text-[var(--goa-color-text-default)] mt-0 mb-4">
          Agent Builder Console is a Government of Alberta tool for composing
          agentic LLM workflows. Sign in with your work account to access
          workflows scoped to your ministry.
        </p>

        <goa-callout
          v-if="errorMessage"
          type="emergency"
          heading="Sign-in failed"
          class="mb-4"
        >
          {{ errorMessage }}
        </goa-callout>

        <div class="flex flex-col gap-3">
          <goa-button
            type="primary"
            leadingicon="log-in"
            :disabled="auth.loading || undefined"
            @_click="signIn"
          >
            <span v-if="auth.loading">Checking your session…</span>
            <span v-else>Sign in with Microsoft</span>
          </goa-button>

          <p
            v-if="hasReturnTo"
            class="text-sm text-[var(--goa-color-text-secondary)] m-0"
            aria-live="polite"
          >
            After sign-in, you'll be returned to
            <code class="font-mono text-xs px-1 py-0.5 bg-[var(--goa-color-greyscale-100)] rounded">{{ returnTo }}</code>.
          </p>

          <p class="text-sm text-[var(--goa-color-text-secondary)] m-0">
            Your session is restricted to your ministry. Activity is logged for
            security and compliance.
          </p>
        </div>
      </goa-container>

      <!-- Right column: orientation. Tells a first-timer what this is for. -->
      <goa-container type="non-interactive" padding="relaxed" heading="What you can do here">
        <ul class="m-0 p-0 list-none flex flex-col gap-4 text-base">
          <li>
            <strong class="block text-[var(--goa-color-text-default)]">Compose a Free Agent task.</strong>
            <span class="text-[var(--goa-color-text-secondary)]">
              Describe a task in plain language, pick an approved model, and
              watch the agent iterate with PII scanning and audit at every step.
            </span>
          </li>
          <li>
            <strong class="block text-[var(--goa-color-text-default)]">Build a multi-stage workflow.</strong>
            <span class="text-[var(--goa-color-text-secondary)]">
              Drag agents, deterministic functions, and tools onto a canvas to
              compose a workflow you can save, version, and re-run.
            </span>
          </li>
          <li>
            <strong class="block text-[var(--goa-color-text-default)]">Review audit and PII activity.</strong>
            <span class="text-[var(--goa-color-text-secondary)]">
              Admins can inspect every session, every PII detection, and the
              model registry under the Admin tab.
            </span>
          </li>
        </ul>
      </goa-container>
    </div>
  </section>
</template>
