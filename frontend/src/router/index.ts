import { createRouter, createWebHistory } from 'vue-router'
import FreeAgentView from '@/views/FreeAgentView.vue'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'free-agent',
      component: FreeAgentView,
    },
    {
      path: '/workflow',
      name: 'workflow',
      component: () => import('@/views/WorkflowView.vue'),
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { requiresAdmin: true },
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.loadUser()
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { path: '/' }
  }
})

export default router
