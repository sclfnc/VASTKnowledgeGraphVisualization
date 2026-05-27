<script setup>
import { ref, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import GuidePanel from '../components/GuidePanel.vue'
import PanelFocus from '../components/PanelFocus.vue'
import { injectSchema } from '../composables/useSchema.js'
import { useGraphStore } from '../stores/graph.js'
import { usePanelsStore } from '../stores/panels.js'

// Per-graph singletons (schema, nodes, edges, effective types, attribute
// index, centrality poller/status) are provided at App.vue root so both
// AppSidebar and GuideView see the same instances. Here we only read schema
// + graphId for our own template.
const { schema } = injectSchema()
const { graphId } = storeToRefs(useGraphStore())

const panelsStore = usePanelsStore()
const { orderedActive } = storeToRefs(panelsStore)
const { toggle } = panelsStore

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
