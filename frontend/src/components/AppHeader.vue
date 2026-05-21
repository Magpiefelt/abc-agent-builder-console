<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUserMemoryStore } from '@/stores/userMemory'

const auth = useAuthStore()
const memory = useUserMemoryStore()
const router = useRouter()

async function handleLogout(): Promise<void> {
  await auth.logout()
  memory.reset()
  await router.push({ name: 'login' })
}
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
      <RouterLink v-if="auth.isAdmin" slot="navigation" to="/admin" active-class="current">Admin</RouterLink>
    </template>

    <div v-if="auth.isAuthenticated && auth.user" slot="utilities" class="flex items-center gap-3">
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

    <div v-else slot="utilities">
      <RouterLink :to="{ name: 'login' }" class="text-sm font-medium">Sign in</RouterLink>
    </div>
  </goa-app-header>
</template>
