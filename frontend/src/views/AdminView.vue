<script setup lang="ts">
import { ref, computed, watch, markRaw, type Component } from 'vue'
import DashboardPanel from '@/components/admin/DashboardPanel.vue'
import AuditLogViewer from '@/components/admin/AuditLogViewer.vue'
import PIIDetectionViewer from '@/components/admin/PIIDetectionViewer.vue'
import ModelRegistryEditor from '@/components/admin/ModelRegistryEditor.vue'
import SessionInspector from '@/components/admin/SessionInspector.vue'
import HealthDiagnostics from '@/components/admin/HealthDiagnostics.vue'
import TrashPanel from '@/components/admin/TrashPanel.vue'
import BudgetPanel from '@/components/admin/BudgetPanel.vue'
import WebhooksPanel from '@/components/admin/WebhooksPanel.vue'
import EvidencePanel from '@/components/admin/EvidencePanel.vue'
import { useDocumentTitle } from '@/composables/useDocumentTitle'

interface Tab {
  id: string
  label: string
  group: 'operations' | 'compliance' | 'configuration'
  component: Component
}

const tabs: Tab[] = [
  { id: 'dashboard', label: 'Dashboard',           group: 'operations',    component: markRaw(DashboardPanel) },
  { id: 'health',    label: 'Health diagnostics',  group: 'operations',    component: markRaw(HealthDiagnostics) },
  { id: 'audit',     label: 'Audit log',           group: 'compliance',    component: markRaw(AuditLogViewer) },
  { id: 'pii',       label: 'PII detections',      group: 'compliance',    component: markRaw(PIIDetectionViewer) },
  { id: 'evidence',  label: 'Compliance evidence', group: 'compliance',    component: markRaw(EvidencePanel) },
  { id: 'models',    label: 'Model registry',      group: 'configuration', component: markRaw(ModelRegistryEditor) },
  { id: 'sessions',  label: 'Sessions',            group: 'configuration', component: markRaw(SessionInspector) },
  { id: 'trash',     label: 'Workflow trash',      group: 'configuration', component: markRaw(TrashPanel) },
  { id: 'budgets',   label: 'Token budgets',       group: 'configuration', component: markRaw(BudgetPanel) },
  { id: 'webhooks',  label: 'Webhooks',            group: 'configuration', component: markRaw(WebhooksPanel) },
]

const tabIds = tabs.map((t) => t.id)
const defaultTabId = tabs[0]!.id

function tabFromHash(): string {
  if (typeof window === 'undefined') return defaultTabId
  const h = window.location.hash.replace(/^#/, '')
  return tabIds.includes(h) ? h : defaultTabId
}

const active = ref<string>(tabFromHash())
const activeTab = computed<Tab>(() => tabs.find((t) => t.id === active.value) ?? tabs[0]!)

useDocumentTitle(() => `Admin · ${activeTab.value.label}`)

function select(id: string) {
  active.value = id
}

watch(active, (id) => {
  if (window.location.hash !== `#${id}`) {
    history.replaceState(null, '', `#${id}`)
  }
})

const sections: { id: string; label: string; items: Tab[] }[] = [
  { id: 'operations',    label: 'Operations',    items: tabs.filter((t) => t.group === 'operations') },
  { id: 'compliance',    label: 'Compliance',    items: tabs.filter((t) => t.group === 'compliance') },
  { id: 'configuration', label: 'Configuration', items: tabs.filter((t) => t.group === 'configuration') },
]
</script>

<template>
  <div class="h-full flex">
    <goa-work-side-menu class="w-60 shrink-0" heading="Administration">
      <template v-for="section in sections" :key="section.id">
        <span slot="heading">{{ section.label }}</span>
        <a
          v-for="item in section.items"
          :key="item.id"
          slot="links"
          :href="`#${item.id}`"
          :data-active="active === item.id ? 'true' : 'false'"
          :aria-current="active === item.id ? 'page' : undefined"
          @click.prevent="select(item.id)"
        >
          {{ item.label }}
        </a>
      </template>
    </goa-work-side-menu>

    <section class="flex-1 overflow-y-auto bg-[var(--goa-color-background)] p-6">
      <goa-callout type="information" heading="Audit-logged area" class="mb-5">
        All actions on this page are audit-logged. Entries are retained per the Government of Alberta retention schedule.
      </goa-callout>
      <KeepAlive>
        <component :is="activeTab.component" :key="activeTab.id" />
      </KeepAlive>
    </section>
  </div>
</template>