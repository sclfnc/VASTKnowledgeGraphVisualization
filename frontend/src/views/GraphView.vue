<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import GuidePanel from '@/components/GuidePanel.vue'
import PanelFocus from '@/components/PanelFocus.vue'
import { useGraphStore } from '../stores/graph.js'
import { storeToRefs } from 'pinia'
import { injectSchema } from '@/composables/useSchema.js'
import { usePanelsStore } from '@/stores/panels.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'

const { schema } = injectSchema()
const { graphId } = storeToRefs(useGraphStore())
const { edgeTypeList } = useEffectiveType(graphId, schema)

const panelsStore = usePanelsStore()
const { orderedActive } = storeToRefs(panelsStore)

const panels = computed(() =>
  orderedActive.value.filter(
    p => (typeof p.available !== 'function' || p.available(schema.value, edgeTypeList.value))
      && p.view == 'graph'
  )
)


// This section has an opinionated layout, while mantaining responsiveness and some flexibility
// - No panel can be removed
// - Node-Link Diagram is expanded on first load
// - One of Node-Link Diagram and Ego Network is always expanded: when minimizing one of the two the other one is expanded
// - Edge Overwiew panels (Edge Flows and Edge Types) cannot be expanded
// - Edge Overview panels are always adjacent (in row or column, depending on which makes more sense with the current layout)
// - Edge Overview panels are displayed first in 1-column layout

const focused = ref(null)
const expandedId = ref('graph_node_link')
const widenedId = ref(null)
const controlsOpenId = ref(null)
const drawerReady = ref(false)

function drawerIdFor(id) { return `panel-drawer-${id}` }

function toggleExpand(id) {
  const isEnlarged = expandedId.value === id || widenedId.value === id
  expandedId.value = !isEnlarged ? id
    // One of node_link or ego is always expanded
    : id == 'graph_node_link' ? 'graph_ego' : 'graph_node_link'
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


// Keep track of viewport width in order to determine if panels should be resizable
const lgBreakpoint = 1024
const resizable = ref(window.innerWidth >= lgBreakpoint)
function handleResizeWindow() {
  resizable.value = window.innerWidth >= lgBreakpoint
}

onMounted(() => {
  window.addEventListener('resize', handleResizeWindow)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResizeWindow)
})

</script>

<template>
  <div class="grid auto-rows-min grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
    <GuidePanel
      v-for="p in panels.filter(p => p.section == 'Main')" :key="p.id"
      :panel-spec="p"
      :schema="schema"
      :graph-id="graphId"
      :expanded="(expandedId === p.id) && resizable"
      :widened="(widenedId === p.id) && resizable"
      :controls-open="controlsOpenId === p.id"
      :drawer-id="drawerIdFor(p.id)"
      :drawer-ready="drawerReady && controlsOpenId === p.id"
      :resizable="resizable && p.resizable"
      :removable="false"
      :lockable="false"
      :order="p.order"
      @remove="toggle(p)"
      @focus="focused = p"
      @toggle-expand="toggleExpand(p.id)"
      @toggle-controls="toggleControls(p.id)"
      @request-widen="requestWiden(p.id)"
      @request-shrink="requestShrink(p.id)" />

    <div class="grid grid-cols-subgrid gap-4 order-first lg:order-2 lg:col-span-2"
      :class="[
        expandedId == 'graph_ego' ? 'xl:col-span-2 lg:col-span-1' : 'xl:col-span-1',
      ]">
      <GuidePanel
        v-for="p in panels.filter(p => p.section == 'Edge Overview')" :key="p.id"
        :panel-spec="p"
        :schema="schema"
        :graph-id="graphId"
        :expanded="(expandedId === p.id) && resizable"
        :widened="(widenedId === p.id) && resizable"
        :controls-open="controlsOpenId === p.id"
        :drawer-id="drawerIdFor(p.id)"
        :drawer-ready="drawerReady && controlsOpenId === p.id"
        :resizable="resizable && p.resizable"
        :removable="false"
        :lockable="false"
        @remove="toggle(p)"
        @focus="focused = p"
        @toggle-expand="toggleExpand(p.id)"
        @toggle-controls="toggleControls(p.id)"
        @request-widen="requestWiden(p.id)"
        @request-shrink="requestShrink(p.id)" />
    </div>
  </div>


  <PanelFocus :panel="focused" :schema="schema" :graph-id="graphId" @close="focused = null" />
</template>
