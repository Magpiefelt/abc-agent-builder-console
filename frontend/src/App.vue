<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
</script>

<template>
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-black focus:px-3 focus:py-1.5 focus:rounded focus:ring-2 focus:ring-black"
  >
    Skip to main content
  </a>
  <AppHeader />
  <main id="main-content" tabindex="-1" class="flex-1 overflow-hidden">
    <RouterView />
  </main>
</template>
