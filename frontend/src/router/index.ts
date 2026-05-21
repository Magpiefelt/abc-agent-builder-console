import { createRouter, createWebHistory } from 'vue-router'
import FreeAgentView from '@/views/FreeAgentView.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'free-agent',
      component: FreeAgentView,
      meta: { requiresAuth: true },
    },
    {
      path: '/workflows',
      name: 'workflow-list',
      component: () => import('@/views/WorkflowListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/workflows/:id',
      name: 'workflow-edit',
      component: () => import('@/views/WorkflowView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/ProfileView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/workflow',
      redirect: '/workflows',
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
  ],
})

router.beforeEach(useAuthGuard())

export default router
