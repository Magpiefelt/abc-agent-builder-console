<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAgentSessionStore } from '@/stores/agentSession'
import TaskPanel from '@/components/freeAgent/TaskPanel.vue'
import ControlBar from '@/components/freeAgent/ControlBar.vue'
import IterationTimeline from '@/components/freeAgent/IterationTimeline.vue'
import BlackboardViewer from '@/components/freeAgent/BlackboardViewer.vue'
import ScratchpadViewer from '@/components/freeAgent/ScratchpadViewer.vue'
import ArtifactsPanel from '@/components/freeAgent/ArtifactsPanel.vue'
import FinalReportPanel from '@/components/freeAgent/FinalReportPanel.vue'
import AgentCanvas from '@/components/freeAgent/AgentCanvas.vue'
import { useDocumentTitle } from '@/composables/useDocumentTitle'

type MemoryTab = 'blackboard' | 'scratchpad' | 'artifacts'

const session = useAgentSessionStore()
const route = useRoute()
const router = useRouter()

useDocumentTitle(() => {
  if (session.replayMode) return 'Free Agent · replay'
  switch (session.status) {
    case 'running': return 'Free Agent · running'
    case 'paused': return 'Free Agent · paused'
    case 'needs_assistance': return 'Free Agent · needs input'
    case 'completed': return 'Free Agent · done'
    case 'error': return 'Free Agent · error'
    default: return 'Free Agent'
  }
})

const memoryTab = ref<MemoryTab>('blackboard')
const taskOpenMobile = ref(true)
const sheetOpenMobile = ref(false)

const showFinalReport = computed(
  () => session.status === 'completed' && session.finalReport !== null,
)

const replayId = computed(() => {
  // `route` is undefined when this view is mounted outside a router (e.g. in
  // isolated unit tests that don't install vue-router).
  const id = route?.params?.id
  return typeof id === 'string' && id ? id : null
})

async function hydrateReplay(id: string): Promise<void> {
  await session.loadReplay(id)
}

onMounted(() => {
  if (replayId.value) {
    void hydrateReplay(replayId.value)
  } else if (session.replayMode) {
    // Returning to "/" from a replay route should clear the read-only state.
    session.reset()
  }
})

watch(replayId, (id, prev) => {
  if (id && id !== prev) {
    void hydrateReplay(id)
  } else if (!id && session.replayMode) {
    session.reset()
  }
})

function exitReplay(): void {
  session.reset()
  router?.push({ name: 'free-agent' })
}

function selectTab(tab: MemoryTab): void {
  memoryTab.value = tab
  sheetOpenMobile.value = true
}
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- Replay banner: only when viewing a past session -->
    <div
      v-if="session.replayMode"
      class="px-4 py-2 bg-[var(--goa-color-primary-light)] border-b border-[var(--goa-color-border)] flex items-center justify-between text-sm"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-center gap-3">
        <span class="font-semibold text-[var(--goa-color-primary-dark)]">
          Viewing past session
        </span>
        <span v-if="session.replayLoading" class="text-[var(--goa-color-text-secondary)]">
          Loading…
        </span>
        <span v-else-if="session.replayError" class="text-[var(--goa-color-emergency)]">
          {{ session.replayError }}
        </span>
        <span v-else class="text-[var(--goa-color-text-secondary)]">
          Status: {{ session.status }} &middot; {{ session.iterations.length }} iteration(s)
        </span>
      </div>
      <goa-button type="tertiary" size="compact" leadingicon="close" @_click="exitReplay">
        Exit replay
      </goa-button>
    </div>

  <div class="flex-1 flex flex-col md:flex-row min-h-0">
    <!-- Desktop: left panel -->
    <aside class="hidden md:flex md:w-80 md:shrink-0 h-full" aria-label="Task configuration">
      <TaskPanel class="w-full" />
    </aside>

    <!-- Mobile: collapsible task panel -->
    <div class="md:hidden border-b border-[var(--goa-color-border)] bg-[var(--goa-color-surface)]">
      <button
        type="button"
        @click="taskOpenMobile = !taskOpenMobile"
        :aria-expanded="taskOpenMobile"
        class="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-semibold text-[var(--goa-color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)]"
      >
        <span>Task Configuration</span>
        <span aria-hidden="true">{{ taskOpenMobile ? '▾' : '▸' }}</span>
      </button>
      <div v-if="taskOpenMobile" class="max-h-[60vh] overflow-y-auto">
        <TaskPanel />
      </div>
    </div>

    <!-- Center column -->
    <section class="flex-1 flex flex-col min-w-0 min-h-0" aria-label="Agent execution canvas">
      <ControlBar />
      <div class="flex-1 flex flex-col min-h-0 p-3 gap-3 overflow-hidden">
        <FinalReportPanel v-if="showFinalReport" class="flex-1 min-h-[180px]" />
        <template v-else>
          <div class="flex-1 min-h-[200px]">
            <AgentCanvas />
          </div>
          <div class="flex-1 min-h-[180px]">
            <IterationTimeline />
          </div>
        </template>
      </div>
    </section>

    <!-- Desktop: right memory column -->
    <aside
      class="hidden md:flex md:flex-col md:w-80 md:shrink-0 bg-[var(--goa-color-surface)] border-l border-[var(--goa-color-border)] h-full"
      aria-label="Agent memory viewer"
    >
      <goa-tabs initialtab="1" class="flex-1 min-h-0 flex flex-col">
        <goa-tab
          :heading="session.blackboard.length > 0 ? `Blackboard (${session.blackboard.length})` : 'Blackboard'"
        >
          <div class="p-3 h-full"><BlackboardViewer /></div>
        </goa-tab>
        <goa-tab heading="Scratchpad">
          <div class="p-3 h-full"><ScratchpadViewer /></div>
        </goa-tab>
        <goa-tab
          :heading="session.artifacts.length > 0 ? `Artifacts (${session.artifacts.length})` : 'Artifacts'"
        >
          <div class="p-3 h-full"><ArtifactsPanel /></div>
        </goa-tab>
      </goa-tabs>
    </aside>

    <!-- Mobile bottom-sheet -->
    <div class="md:hidden">
      <div
        v-if="sheetOpenMobile"
        class="fixed inset-x-0 bottom-12 z-30 bg-[var(--goa-color-surface)] border-t border-[var(--goa-color-border)] shadow-lg max-h-[60vh] flex flex-col"
        role="region"
        aria-label="Memory viewer"
      >
        <header class="flex items-center justify-between px-3 py-2 border-b border-[var(--goa-color-border)]">
          <span class="text-sm font-semibold text-[var(--goa-color-primary-dark)]">
            {{ memoryTab === 'blackboard' ? 'Blackboard' : memoryTab === 'scratchpad' ? 'Scratchpad' : 'Artifacts' }}
          </span>
          <button
            type="button"
            @click="sheetOpenMobile = false"
            aria-label="Close memory sheet"
            class="text-[var(--goa-color-text-secondary)] hover:text-[var(--goa-color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--goa-color-primary)] rounded p-1"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" fill="none" />
            </svg>
          </button>
        </header>
        <div class="flex-1 min-h-0 p-3 overflow-y-auto">
          <BlackboardViewer v-if="memoryTab === 'blackboard'" />
          <ScratchpadViewer v-else-if="memoryTab === 'scratchpad'" />
          <ArtifactsPanel v-else />
        </div>
      </div>

      <nav
        class="fixed inset-x-0 bottom-0 z-30 h-12 bg-[var(--goa-color-surface)] border-t border-[var(--goa-color-border)] flex"
        aria-label="Memory tabs"
      >
        <button
          v-for="tab in (['blackboard', 'scratchpad', 'artifacts'] as MemoryTab[])"
          :key="tab"
          type="button"
          @click="selectTab(tab)"
          :aria-pressed="sheetOpenMobile && memoryTab === tab"
          :class="[
            'flex-1 text-xs font-medium flex flex-col items-center justify-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--goa-color-primary)]',
            sheetOpenMobile && memoryTab === tab
              ? 'text-[var(--goa-color-primary-dark)] bg-[var(--goa-color-primary-light)]'
              : 'text-[var(--goa-color-text-secondary)]',
          ]"
        >
          <span>
            {{ tab === 'blackboard' ? 'Blackboard' : tab === 'scratchpad' ? 'Scratchpad' : 'Artifacts' }}
          </span>
          <span
            v-if="tab === 'blackboard' && session.blackboard.length > 0"
            class="text-[10px]"
          >{{ session.blackboard.length }}</span>
          <span
            v-else-if="tab === 'artifacts' && session.artifacts.length > 0"
            class="text-[10px]"
          >{{ session.artifacts.length }}</span>
        </button>
      </nav>
    </div>
  </div>
  </div>
</template>
