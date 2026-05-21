<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
  <div
    class="min-h-full flex items-center justify-center p-6 bg-[var(--goa-color-background)]"
  >
    <div
      class="w-full max-w-md bg-[var(--goa-color-surface)] rounded-lg shadow-md border border-[var(--goa-color-border)] p-8"
    >
      <div class="text-center mb-6">
        <h1 class="text-2xl font-bold text-[var(--goa-color-primary-dark)]">
          Agent Builder Console
        </h1>
        <p class="text-sm text-[var(--goa-color-text-secondary)] mt-2">
          Government of Alberta &mdash; sign in with your work account to continue.
        </p>
      </div>

      <div
        v-if="errorMessage"
        class="mb-4 p-3 rounded border border-[var(--goa-color-error)] bg-red-50 text-sm text-[var(--goa-color-error)]"
        role="alert"
      >
        {{ errorMessage }}
      </div>

      <button
        type="button"
        class="w-full py-2.5 px-4 bg-[var(--goa-color-primary)] text-white font-medium rounded-md hover:bg-[var(--goa-color-primary-dark)] disabled:opacity-60 transition-colors"
        :disabled="auth.loading"
        @click="signIn"
      >
        <span v-if="auth.loading">Checking your session&hellip;</span>
        <span v-else>Sign in with Microsoft</span>
      </button>

      <p class="text-xs text-[var(--goa-color-text-secondary)] mt-6 text-center">
        Your session is restricted to your ministry. Activity is audited.
      </p>
    </div>
  </div>
</template>
