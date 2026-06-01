<script setup>
// Single left sidebar — shared chrome (brand, mode, dataset, about) plus
// a body that switches between "Contents" (panel list) and "Filters"
// (node + edge attribute filters). The two modes are mutually exclusive
// because the user rarely needs both at once: layout decisions in
// Contents, exploration in Filters. Light theme; full-height; fixed.
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { Telescope, Network, BookOpen } from 'lucide-vue-next'
import { useGraphStore } from '../stores/graph.js'
import { useSidebarsStore } from '../stores/sidebars.js'
import { useSelectionStore } from '../stores/selection.js'
import { useAboutModal } from '../composables/useAboutModal.js'
import GraphStatus from './GraphStatus.vue'

const graphStore = useGraphStore()
const sidebars = useSidebarsStore()
const selection = useSelectionStore()
const { mode: sidebarMode } = storeToRefs(sidebars)
const { graphId } = storeToRefs(graphStore)
const { ids: selectedIds, edgeIds: selectedEdgeIds } = storeToRefs(selection)
const { openAbout } = useAboutModal()
const router = useRouter()


const viewLinks = [
  { name: 'graph', label: 'Graph', icon: Network },
  { name: 'guide', label: 'Guide', icon: BookOpen },
  // Additional nested views of dashboard
]

// "Change dataset" two-click confirm pattern (replaces the native confirm()
// dialog from the old DatasetDropdown). Click once to arm; click again
// within CHANGE_CONFIRM_MS to navigate to /dataset; otherwise auto-revert.
const CHANGE_CONFIRM_MS = 3000
const changeArmed = ref(false)
let changeArmTimer = null
function onChangeDataset() {
  if (changeArmed.value) {
    if (changeArmTimer) { clearTimeout(changeArmTimer); changeArmTimer = null }
    changeArmed.value = false
    router.push({ name: 'dataset' })
    return
  }
  changeArmed.value = true
  changeArmTimer = setTimeout(() => { changeArmed.value = false; changeArmTimer = null }, CHANGE_CONFIRM_MS)
}
</script>

<template>
  <aside class="surface-recessed fixed left-0 top-0 z-30 h-screen w-[300px] border-r border-slate-300 flex flex-col">

    <!-- Header zone: fixed at top, never scrolls. -->
    <header class="shrink-0 px-4 pt-3 pb-2 flex flex-col gap-2 border-b border-slate-300 ">
      <button
        class="group flex items-center gap-2 cursor-pointer focus:outline-none"
        :title="'About Telescope'"
        @click="openAbout">
        <Telescope :size="36" :stroke-width="1.75" class="shrink-0 text-primary" />
        <div class="flex flex-col items-start text-left">
          <span
            class="inline-flex items-baseline gap-1 text-xl font-bold leading-none text-primary group-hover:underline decoration-2 underline-offset-4">
            Telescope
            <Info :size="10" :stroke-width="2.25"
              class="text-secondary opacity-50 group-hover:opacity-100 transition-opacity" />
          </span>
          <span class="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">Zoom into your
            graph</span>
        </div>
      </button>

      <!-- Row 1: Graph/Guide view toggle (140px track).
       This works well with only two view, if we want to extend it, someone has
       to write the template differently
      -->
      <nav class="segmented-track flex items-center w-[210px] mx-auto">
        <button
          v-for="link in viewLinks"
          :key="link.name"
          class="segmented-pill flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-xs"
          :class="{ 'segmented-pill--active': $route.name === link.name }"
          @click="router.push({ name: link.name })">
          <component :is="link.icon" :size="12" />
          <span>{{ link.label }}</span>
        </button>
      </nav>


      <!-- Graph identity: thin always-visible row (name + flags). Counts and
           the node/edge inspector moved into the Filters body to keep the
           shared header light and Contents clean. -->
      <GraphStatus v-if="graphId" section="identity" />

    </header>

    <!-- Body zone: only this scrolls. -->
    <RouterView name="sidebar" />

    <!-- Footer: Change dataset only. About lives in the brand block at top. -->
    <div v-if="graphId" class="shrink-0 border-t border-slate-300 px-4 py-2 flex justify-center">
      <div class="segmented-track flex items-center w-[210px]">
        <button
          class="segmented-pill flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-xs"
          :class="changeArmed ? 'segmented-pill--active text-amber-600' : ''"
          :title="changeArmed ? 'Click again to confirm' : 'Switch to a different dataset'"
          @click="onChangeDataset">
          <Database :size="12" />
          <span>{{ changeArmed ? 'Click again to confirm' : 'Change dataset' }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>
