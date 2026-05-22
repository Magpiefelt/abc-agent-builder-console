<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
</script>

<template>
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-[var(--goa-color-surface)] focus:text-[var(--goa-color-text-default)] focus:px-3 focus:py-1.5 focus:rounded focus:ring-2 focus:ring-[var(--goa-color-primary)]"
  >
    Skip to main content
  </a>

  <!--
    Microsite header sits above the goa-app-header on every page, per the GoA
    standard auth-shell pattern. The "alpha" phase label is honest until
    Streams A-F land in production. Feedback href is a placeholder; wire to the
    real ticket form once it's published.
  -->
  <goa-microsite-header
    type="alpha"
    version="ABC"
    feedbackurl="mailto:cohen.mcleod@gov.ab.ca?subject=ABC%20feedback"
  ></goa-microsite-header>

  <AppHeader />

  <main id="main-content" tabindex="-1" class="flex-1 overflow-hidden">
    <RouterView />
  </main>

  <goa-footer
    nav-section-maxcolumncount="2"
    meta-section-maxcolumncount="1"
  >
    <a slot="nav" href="https://www.alberta.ca" target="_blank" rel="noopener">Alberta.ca</a>
    <a slot="meta" href="mailto:cohen.mcleod@gov.ab.ca">Contact</a>
  </goa-footer>

  <ToastContainer />
</template>
