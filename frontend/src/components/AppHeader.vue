<script setup lang="ts">
import { RouterLink } from 'vue-router'
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
          to="/workflows"
          class="px-3 py-1.5 rounded text-sm font-medium hover:bg-white/10 transition-colors"
          active-class="bg-white/20"
        >
          Workflows
        </RouterLink>
      </nav>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-sm opacity-80 hidden sm:inline">Cohen McLeod</span>
      <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
        CM
      </div>
    </div>
  </header>
</template>
