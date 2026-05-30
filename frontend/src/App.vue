<script setup>
import { RouterView } from 'vue-router'
import { computed, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useGraphStore } from './stores/graph.js'
import { useAboutModal } from './composables/useAboutModal.js'
import { useSchema, SCHEMA_KEY } from './composables/useSchema.js'
import { useGraphNodes, GRAPH_NODES_KEY } from './composables/useGraphNodes.js'
import { useGraphEdges, GRAPH_EDGES_KEY } from './composables/useGraphEdges.js'
import { useEffectiveTypes, EFFECTIVE_TYPES_KEY } from './composables/useEffectiveTypes.js'
import { useAttributeIndex, ATTRIBUTE_INDEX_KEY } from './composables/useAttributeIndex.js'
import { useCentralityPoller } from './composables/useCentralityPoller.js'
import AppSidebar from './components/AppSidebar.vue'
import AboutModal from './components/AboutModal.vue'
import TimelineParsingSettingsModal from './components/TimelineParsingSettingsModal.vue'

const graphStore = useGraphStore()
const { open: aboutOpen, closeAbout } = useAboutModal()

// AppSidebar takes over all chrome (brand, Mode, Contents/Filters toggle,
// Dataset, About) whenever a graph is loaded. During onboarding the
// DatasetView card owns its own branding header — no sidebar needed.
const sidebarActive = computed(() => Boolean(graphStore.graphId))

// Per-graph singleton resources provided at the App root so both AppSidebar
// (AttributeFilters) and GuideView (panel grid) share the same instances.
// Without this, the sidebar would inject fallbacks → fresh fetches with
// undefined graphId → empty data → node-type colors revert to gray.
const schemaInstance = useSchema()
provide(SCHEMA_KEY, schemaInstance)

const { graphId } = storeToRefs(graphStore)
provide(GRAPH_NODES_KEY, useGraphNodes(graphId))
provide(GRAPH_EDGES_KEY, useGraphEdges(graphId))
provide(EFFECTIVE_TYPES_KEY, useEffectiveTypes(graphId))
provide(ATTRIBUTE_INDEX_KEY, useAttributeIndex(graphId))

const centralityPoller = useCentralityPoller(graphId)
provide('centralityPoller', centralityPoller)

const STATE_RANK = { error: 5, cancelled: 4, computing: 3, pending: 2, ready: 1 }
const centralityStatus = computed(() => {
  const s = centralityPoller.status.value
  let worst = 'ready'
  for (const k of ['spectral', 'betweenness', 'closeness']) {
    const v = s[k] ?? 'pending'
    if ((STATE_RANK[v] ?? 0) > (STATE_RANK[worst] ?? 0)) worst = v
  }
  return { ...s, comparison: worst }
})
provide('centralityStatus', centralityStatus)
</script>

<template>
  <div class="min-h-screen surface-recessed">
    <AppSidebar v-if="sidebarActive" />

    <main
      class="w-full pb-4 pt-3 md:pb-6 md:pt-3"
      :class="sidebarActive
        ? 'pl-[316px] pr-4 md:pr-6'
        : 'mx-auto max-w-[1600px] px-4 md:px-6'"
    >
      <RouterView />
    </main>

    <AboutModal :open="aboutOpen" @close="closeAbout" />
    <TimelineParsingSettingsModal />
  </div>
</template>
