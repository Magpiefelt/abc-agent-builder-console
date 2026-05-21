<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <header class="bg-[var(--goa-color-primary)] text-white px-6 py-3 flex items-center justify-between shadow-md" role="banner">
    <div class="flex items-center gap-4">
      <RouterLink
        to="/"
        class="text-xl font-bold tracking-tight hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--goa-color-primary)] rounded"
        aria-label="Agent Builder Console — home"
      >
        Agent Builder Console
      </RouterLink>
      <nav class="hidden md:flex gap-1 ml-6" aria-label="Primary navigation">
        <RouterLink
          to="/"
          class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--goa-color-primary)]"
          active-class="bg-white/20"
        >
          Free Agent
        </RouterLink>
        <RouterLink
          to="/workflow"
          class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--goa-color-primary)]"
          active-class="bg-white/20"
        >
          Workflow
        </RouterLink>
      </nav>
    </div>
    <div class="flex items-center gap-3" aria-label="User profile">
      <span class="text-sm opacity-80 hidden sm:inline">Cohen McLeod</span>
      <div
        class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold"
        aria-hidden="true"
      >
        CM
      </div>
    </div>
  </header>
</template>
