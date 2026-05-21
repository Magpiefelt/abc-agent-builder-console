<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const displayName = computed(() => auth.user?.displayName ?? 'Signed out')
const initials = computed(() => {
  const name = auth.user?.displayName ?? ''
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–'
})
</script>

<template>
  <header class="bg-[var(--goa-color-primary)] text-white px-6 py-3 flex items-center justify-between shadow-md">
    <div class="flex items-center gap-4">
      <RouterLink to="/" class="text-xl font-bold tracking-tight hover:opacity-90">
        Agent Builder Console
      </RouterLink>
      <nav class="hidden md:flex gap-1 ml-6">
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
        <RouterLink
          v-if="auth.isAdmin"
          to="/admin"
          class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors"
          active-class="bg-white/20"
        >
          Admin
        </RouterLink>
      </nav>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-sm opacity-80 hidden sm:inline">{{ displayName }}</span>
      <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
        {{ initials }}
      </div>
    </div>
  </header>
</template>
