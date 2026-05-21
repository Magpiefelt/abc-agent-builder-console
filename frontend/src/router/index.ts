import { createRouter, createWebHistory } from 'vue-router'
import FreeAgentView from '@/views/FreeAgentView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'free-agent',
      component: FreeAgentView,
    },
    {
      path: '/workflows',
      name: 'workflow-list',
      component: () => import('@/views/WorkflowListView.vue'),
    },
    {
      path: '/workflows/:id',
      name: 'workflow-edit',
      component: () => import('@/views/WorkflowView.vue'),
    },
    {
      path: '/workflow',
      redirect: '/workflows',
    },
  ],
})

export default router
