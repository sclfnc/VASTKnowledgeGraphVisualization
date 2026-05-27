<script setup>
import { ref, computed, nextTick, provide } from 'vue'
import { storeToRefs } from 'pinia'
import GuidePanel from '../components/GuidePanel.vue'
import PanelFocus from '../components/PanelFocus.vue'
import GraphContextBar from '../components/GraphContextBar.vue'
import {
  useSchema, SCHEMA_KEY,
} from '../composables/useSchema.js'
import { useGraphStore } from '../stores/graph.js'
import { usePanelsStore } from '../stores/panels.js'
import { useCentralityPoller } from '../composables/useCentralityPoller.js'
import { useGraphNodes, GRAPH_NODES_KEY } from '../composables/useGraphNodes.js'
import { useGraphEdges, GRAPH_EDGES_KEY } from '../composables/useGraphEdges.js'
import { useEffectiveTypes, EFFECTIVE_TYPES_KEY } from '../composables/useEffectiveTypes.js'
import { useAttributeIndex, ATTRIBUTE_INDEX_KEY } from '../composables/useAttributeIndex.js'

// Single instances of every per-graph resource; descendants reach them via
// inject*() wrappers exported next to each composable. Without this, each
// panel + each composable would fire its own fetch — on MC1 that's 600KB
// /nodes/ ×7+ panels = wasted bandwidth and parser time.
const schemaInstance = useSchema()
const { schema } = schemaInstance
provide(SCHEMA_KEY, schemaInstance)

const { graphId } = storeToRefs(useGraphStore())
provide(GRAPH_NODES_KEY, useGraphNodes(graphId))
provide(GRAPH_EDGES_KEY, useGraphEdges(graphId))
provide(EFFECTIVE_TYPES_KEY, useEffectiveTypes(graphId))
provide(ATTRIBUTE_INDEX_KEY, useAttributeIndex(graphId))
const panelsStore = usePanelsStore()
const { orderedActive } = storeToRefs(panelsStore)
const { toggle } = panelsStore

// Single global centrality poller. Children grab it via inject — no per-panel
// polling, no duplicated network traffic.
const centralityPoller = useCentralityPoller(graphId)
provide('centralityPoller', centralityPoller)

// Derived status object used by GuideContents to render Centrality badges.
// Comparison status is the "worst non-ready" of the three measures, mapped to
// 'ready' only when all three are ready.
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

const focused = ref(null)
const expandedId = ref(null)
const widenedId = ref(null)
const controlsOpenId = ref(null)
const drawerReady = ref(false)

function drawerIdFor(id) { return `panel-drawer-${id}` }

function toggleExpand(id) {
  const isEnlarged = expandedId.value === id || widenedId.value === id
  expandedId.value = isEnlarged ? null : id
  widenedId.value = null
}

function toggleControls(id) {
  if (controlsOpenId.value === id) {
    controlsOpenId.value = null
    drawerReady.value = false
    return
  }
  const switching = controlsOpenId.value !== null
  controlsOpenId.value = null
  drawerReady.value = false
  const open = () => {
    controlsOpenId.value = id
    nextTick(() => { drawerReady.value = true })
  }
  if (switching) nextTick(open); else open()
}

function requestWiden(id) { widenedId.value = id }
function requestShrink(id) { if (widenedId.value === id) widenedId.value = null }
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <GraphContextBar />

    <div v-if="!orderedActive.length" class="flex h-48 items-center justify-center text-sm text-muted">
      Select a panel from Contents ←
    </div>

    <div class="grid auto-rows-min grid-cols-3 gap-4 items-start">
      <GuidePanel
        v-for="p in orderedActive" :key="p.id"
        :panel-spec="p"
        :schema="schema"
        :graph-id="graphId"
        :expanded="expandedId === p.id"
        :widened="widenedId === p.id"
        :controls-open="controlsOpenId === p.id"
        :drawer-id="drawerIdFor(p.id)"
        :drawer-ready="drawerReady && controlsOpenId === p.id"
        @remove="toggle(p)"
        @focus="focused = p"
        @toggle-expand="toggleExpand(p.id)"
        @toggle-controls="toggleControls(p.id)"
        @request-widen="requestWiden(p.id)"
        @request-shrink="requestShrink(p.id)"
      />
    </div>
  </div>

  <PanelFocus :panel="focused" :schema="schema" :graph-id="graphId" @close="focused = null" />
</template>
