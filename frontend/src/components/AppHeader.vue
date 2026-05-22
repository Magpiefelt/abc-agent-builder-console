<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUserMemoryStore } from '@/stores/userMemory'
import { useTheme } from '@/composables/useTheme'

const auth = useAuthStore()
const memory = useUserMemoryStore()
const router = useRouter()
const { preference, resolved, cycleTheme } = useTheme()

async function handleLogout(): Promise<void> {
  await auth.logout()
  memory.reset()
  await router.push({ name: 'login' })
}

// The cycle moves light → dark → system → light. The button announces what
// it WILL do next so screen-reader users hear a verb, not a state.
const themeNextAction = computed(() => {
  switch (preference.value) {
    case 'light':
      return 'Switch to dark theme'
    case 'dark':
      return 'Switch to follow system theme'
    case 'system':
      return 'Switch to light theme'
    default:
      return 'Toggle theme'
  }
})

const themeIcon = computed(() => {
  if (preference.value === 'system') return 'contrast'
  return resolved.value === 'dark' ? 'moon' : 'sunny'
})
</script>

<template>
  <goa-app-header
    version="v2"
    heading="Agent Builder Console"
    url="/"
    maxcontentwidth="100%"
  >
    <template v-if="auth.isAuthenticated">
      <RouterLink slot="navigation" to="/" active-class="current">Free Agent</RouterLink>
      <RouterLink slot="navigation" to="/workflows" active-class="current">Workflows</RouterLink>
      <RouterLink slot="navigation" to="/sessions" active-class="current">Sessions</RouterLink>
      <RouterLink v-if="auth.isAdmin" slot="navigation" to="/admin" active-class="current">Admin</RouterLink>
    </template>

    <div v-if="auth.isAuthenticated && auth.user" slot="utilities" class="flex items-center gap-3">
      <button
        type="button"
        :aria-label="themeNextAction"
        :title="themeNextAction"
        data-testid="theme-toggle"
        class="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[var(--goa-color-border)] bg-[var(--goa-color-surface)] text-[var(--goa-color-text)] hover:bg-[var(--goa-color-greyscale-100)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--goa-color-interactive-default)]"
        @click="cycleTheme"
      >
        <goa-icon :type="themeIcon" size="medium" aria-hidden="true"></goa-icon>
        <span class="sr-only">{{ themeNextAction }}</span>
      </button>
      <goa-badge
        v-if="auth.user.ministryCode"
        type="information"
        :content="auth.user.ministryCode"
      ></goa-badge>
      <RouterLink
        :to="{ name: 'profile' }"
        class="flex items-center gap-2 text-sm font-medium no-underline"
        :aria-label="`Open profile for ${auth.user.displayName}`"
      >
        <span class="hidden sm:inline">{{ auth.user.displayName }}</span>
        <span
          class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--goa-color-info-light)] text-[var(--goa-color-interactive-default)] text-sm font-bold"
          aria-hidden="true"
        >
          {{ auth.initials }}
        </span>
      </RouterLink>
      <goa-button type="tertiary" size="compact" @_click="handleLogout">
        Sign out
      </goa-button>
    </div>

    <div v-else slot="utilities" class="flex items-center gap-3">
      <button
        type="button"
        :aria-label="themeNextAction"
        :title="themeNextAction"
        data-testid="theme-toggle"
        class="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[var(--goa-color-border)] bg-[var(--goa-color-surface)] text-[var(--goa-color-text)] hover:bg-[var(--goa-color-greyscale-100)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--goa-color-interactive-default)]"
        @click="cycleTheme"
      >
        <goa-icon :type="themeIcon" size="medium" aria-hidden="true"></goa-icon>
        <span class="sr-only">{{ themeNextAction }}</span>
      </button>
      <RouterLink :to="{ name: 'login' }" class="text-sm font-medium">Sign in</RouterLink>
    </div>
  </goa-app-header>
</template>
