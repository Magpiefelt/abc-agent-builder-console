<script setup lang="ts">
import { ref, computed, watch, markRaw, type Component } from 'vue'
import AuditLogViewer from '@/components/admin/AuditLogViewer.vue'
import PIIDetectionViewer from '@/components/admin/PIIDetectionViewer.vue'
import ModelRegistryEditor from '@/components/admin/ModelRegistryEditor.vue'
import SessionInspector from '@/components/admin/SessionInspector.vue'
import HealthDiagnostics from '@/components/admin/HealthDiagnostics.vue'

interface Tab {
  id: string
  label: string
  component: Component
}

// markRaw: components do not need to be reactive themselves; this avoids
// Vue wrapping them in a Proxy on every render.
const tabs: Tab[] = [
  { id: 'audit',    label: 'Audit Log',          component: markRaw(AuditLogViewer) },
  { id: 'pii',      label: 'PII Detections',     component: markRaw(PIIDetectionViewer) },
  { id: 'models',   label: 'Model Registry',     component: markRaw(ModelRegistryEditor) },
  { id: 'sessions', label: 'Sessions',           component: markRaw(SessionInspector) },
  { id: 'health',   label: 'Health Diagnostics', component: markRaw(HealthDiagnostics) },
]

const tabIds = tabs.map((t) => t.id)
const defaultTabId = tabs[0]!.id

function tabFromHash(): string {
  if (typeof window === 'undefined') return defaultTabId
  const h = window.location.hash.replace(/^#/, '')
  return tabIds.includes(h) ? h : defaultTabId
}

// Initialize from hash synchronously so the first render shows the right tab.
const active = ref<string>(tabFromHash())
const activeTab = computed<Tab>(() => tabs.find((t) => t.id === active.value) ?? tabs[0]!)

function select(tab: Tab) {
  active.value = tab.id
}

// Keep URL hash in sync with selected tab so refreshes / shared links land on
// the same view.
watch(active, (id) => {
  if (window.location.hash !== `#${id}`) {
    history.replaceState(null, '', `#${id}`)
  }
})
</script>

<template>
  <div class="h-full flex">
    <!-- Left rail: tab navigation -->
    <aside class="w-60 bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] p-4 flex flex-col gap-2 overflow-y-auto shrink-0">
      <h2 class="text-lg font-semibold text-[var(--goa-color-primary-dark)] mb-2">Administration</h2>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        @click="select(tab)"
        :class="[
          'text-left px-3 py-2 rounded text-sm font-medium transition-colors',
          active === tab.id
            ? 'bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]'
            : 'text-[var(--goa-color-text)] hover:bg-gray-100',
        ]"
        :aria-current="active === tab.id ? 'page' : undefined"
      >
        {{ tab.label }}
      </button>
      <div class="mt-auto pt-4 border-t border-[var(--goa-color-border)] text-xs text-[var(--goa-color-text-secondary)]">
        All actions on this page are audit-logged.
      </div>
    </aside>

    <!-- Main panel: active tab content. KeepAlive preserves per-tab state. -->
    <section class="flex-1 overflow-y-auto bg-[var(--goa-color-background)] p-6">
      <KeepAlive>
        <component :is="activeTab.component" :key="activeTab.id" />
      </KeepAlive>
    </section>
  </div>
</template>
