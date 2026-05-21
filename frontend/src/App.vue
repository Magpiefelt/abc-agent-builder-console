<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
</script>

<template>
  <AppHeader />
  <main class="flex-1 overflow-hidden">
    <RouterView />
  </main>
  <ToastContainer />
</template>
