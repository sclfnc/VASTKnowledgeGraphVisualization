import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { useGraphStore } from '../stores/graph.js'
import GuideView from '../views/GuideView.vue'
import GuideSidebar from '@/views/GuideSidebar.vue'
import GraphView from '@/views/GraphView.vue'
import GraphSidebar from '@/views/GraphSidebar.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: 'dashboard'
    },
    {
      path: '/dashboard/',
      name: 'home',
      component: HomeView,
      children: [
        // Dashboard nested views need a default component for the main container
        //  and a component for the body of the sidebar
        {
          path: '',
          name: 'graph',
          components: {
            default: GraphView,
            sidebar: GraphSidebar,
          }
        },
        {
          path: 'guide/',
          name: 'guide',
          components: {
            default: GuideView,
            sidebar: GuideSidebar,
          }

        }
      ],
    },
    // EXTENSION: onboarding route — entry point when no graph is loaded
    {
      path: '/dataset/',
      name: 'dataset',
      component: () => import('../views/DatasetView.vue'),
    },
  ],
})

// EXTENSION: redirect to dataset if no graph is loaded yet
router.beforeEach((to) => {
  if (to.matched[0].name === 'home') {
    const store = useGraphStore()
    if (!store.graphId) return { name: 'dataset' }
  }
})

export default router
