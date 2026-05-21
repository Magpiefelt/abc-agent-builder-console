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
      path: '/workflow',
      name: 'workflow',
      component: () => import('@/views/WorkflowView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/ProfileView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(useAuthGuard())

export default router
