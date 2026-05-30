import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { useGraphStore } from '../stores/graph.js'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    // EXTENSION: onboarding route — entry point when no graph is loaded
    {
      path: '/dataset',
      name: 'dataset',
      component: () => import('../views/DatasetView.vue'),
    },
  ],
})

// EXTENSION: redirect to /dataset if no graph is loaded yet
router.beforeEach((to) => {
  if (to.name === 'home') {
    const store = useGraphStore()
    if (!store.graphId) return { name: 'dataset' }
  }
})

export default router
