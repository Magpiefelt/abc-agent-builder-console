<script setup lang="ts">
import { ref, shallowRef, type Component } from 'vue'
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

const tabs: Tab[] = [
  { id: 'audit', label: 'Audit Log', component: AuditLogViewer },
  { id: 'pii', label: 'PII Detections', component: PIIDetectionViewer },
  { id: 'models', label: 'Model Registry', component: ModelRegistryEditor },
  { id: 'sessions', label: 'Sessions', component: SessionInspector },
  { id: 'health', label: 'Health Diagnostics', component: HealthDiagnostics },
]

const active = ref<string>(tabs[0]!.id)
const activeComponent = shallowRef<Component>(tabs[0]!.component)

function select(tab: Tab) {
  active.value = tab.id
  activeComponent.value = tab.component
}
</script>

<template>
  <div class="h-full flex">
    <!-- Left rail: tab navigation -->
    <aside class="w-60 bg-[var(--goa-color-surface)] border-r border-[var(--goa-color-border)] p-4 flex flex-col gap-2 overflow-y-auto shrink-0">
      <h2 class="text-lg font-semibold text-[var(--goa-color-primary-dark)] mb-2">Administration</h2>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="select(tab)"
        :class="[
          'text-left px-3 py-2 rounded text-sm font-medium transition-colors',
          active === tab.id
            ? 'bg-[var(--goa-color-primary-light)] text-[var(--goa-color-primary-dark)]'
            : 'text-[var(--goa-color-text)] hover:bg-gray-100',
        ]"
      >
        {{ tab.label }}
      </button>
      <div class="mt-auto pt-4 border-t border-[var(--goa-color-border)] text-xs text-[var(--goa-color-text-secondary)]">
        All actions on this page are audit-logged.
      </div>
    </aside>

    <!-- Main panel: active tab content. KeepAlive avoids refetch on tab switch. -->
    <section class="flex-1 overflow-y-auto bg-[var(--goa-color-background)] p-6">
      <KeepAlive>
        <component :is="activeComponent" />
      </KeepAlive>
    </section>
  </div>
</template>
