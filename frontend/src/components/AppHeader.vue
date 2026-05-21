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
  <header
    class="bg-[var(--goa-color-primary)] text-white px-6 py-3 flex items-center justify-between shadow-md"
  >
    <div class="flex items-center gap-4">
      <RouterLink to="/" class="text-xl font-bold tracking-tight hover:opacity-90">
        Agent Builder Console
      </RouterLink>
      <nav v-if="auth.isAuthenticated" class="hidden md:flex gap-1 ml-6">
        <RouterLink
          to="/"
          class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors"
          active-class="bg-white/20"
        >
          Free Agent
        </RouterLink>
        <RouterLink
          to="/workflow"
          class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors"
          active-class="bg-white/20"
        >
          Workflow
        </RouterLink>
      </nav>
    </div>

    <div v-if="auth.isAuthenticated && auth.user" class="flex items-center gap-3">
      <span
        v-if="auth.user.ministryCode"
        class="hidden sm:inline-flex items-center px-2 py-0.5 text-xs font-semibold uppercase tracking-wide rounded bg-white/20"
        :title="`Ministry: ${auth.user.ministryCode}`"
      >
        {{ auth.user.ministryCode }}
      </span>
      <RouterLink
        :to="{ name: 'profile' }"
        class="flex items-center gap-2 hover:opacity-90"
        :title="`Open profile (${auth.user.displayName})`"
      >
        <span class="text-sm opacity-90 hidden sm:inline">{{ auth.user.displayName }}</span>
        <div
          class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold"
          aria-hidden="true"
        >
          {{ auth.initials }}
        </div>
      </RouterLink>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors"
        @click="handleLogout"
      >
        Sign out
      </button>
    </div>
    <div v-else class="flex items-center gap-3">
      <RouterLink
        :to="{ name: 'login' }"
        class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors"
      >
        Sign in
      </RouterLink>
    </div>
  </header>
</template>
