<script setup>
// Single left sidebar — shared chrome (brand, mode, dataset, about) plus
// a body that switches between "Contents" (panel list) and "Filters"
// (node + edge attribute filters). The two modes are mutually exclusive
// because the user rarely needs both at once: layout decisions in
// Contents, exploration in Filters. Light theme; full-height; fixed.
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { Telescope, ListTree, SlidersHorizontal, Info, Database } from 'lucide-vue-next'
import { useGraphStore } from '../stores/graph.js'
import { useSidebarsStore } from '../stores/sidebars.js'
import { useSelectionStore } from '../stores/selection.js'
import { useAboutModal } from '../composables/useAboutModal.js'
import { injectSchema } from '../composables/useSchema.js'
import GuideContents from './GuideContents.vue'
import GraphStatus from './GraphStatus.vue'
import GraphHeaderStrip from './GraphHeaderStrip.vue'
import ModeToggle from './ModeToggle.vue'
import AttributeFilters from '../panels/AttributeFilters.vue'

const graphStore = useGraphStore()
const sidebars = useSidebarsStore()
const selection = useSelectionStore()
const { mode: sidebarMode } = storeToRefs(sidebars)
const { graphId } = storeToRefs(graphStore)
const { ids: selectedIds, edgeIds: selectedEdgeIds } = storeToRefs(selection)
const { openAbout } = useAboutModal()
const { schema } = injectSchema()
const router = useRouter()

// The node/edge inspector lives in the Filters body. When a selection is made
// from the grid while the user is on Contents, surface it by switching to
// Filters — but only on the rising edge (empty → non-empty), so we never trap
// the user in Filters if they intentionally went back to Contents.
watch(
  () => selectedIds.value.length + selectedEdgeIds.value.length,
  (count, prev) => {
    if (count > 0 && (prev ?? 0) === 0 && sidebarMode.value === 'contents') {
      sidebars.setMode('filters')
    }
  },
)

const MODE_OPTIONS = [
  { k: 'contents', label: 'Contents', icon: ListTree },
  { k: 'filters',  label: 'Filters',  icon: SlidersHorizontal },
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
  <aside class="surface-recessed fixed left-0 top-0 z-30 h-screen w-[300px] border-r border-slate-200 flex flex-col">

    <!-- Header zone: fixed at top, never scrolls. -->
    <div class="shrink-0 px-4 pt-3 pb-2 flex flex-col gap-2">
      <button
        class="group flex items-center gap-2 cursor-pointer focus:outline-none"
        :title="'About Telescope'"
        @click="openAbout"
      >
        <Telescope :size="36" :stroke-width="1.75" class="shrink-0 text-primary" />
        <div class="flex flex-col items-start text-left">
          <span class="inline-flex items-baseline gap-1 text-xl font-bold leading-none text-primary group-hover:underline decoration-2 underline-offset-4">
            Telescope
            <Info :size="10" :stroke-width="2.25" class="text-secondary opacity-50 group-hover:opacity-100 transition-opacity" />
          </span>
          <span class="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">Zoom into your graph</span>
        </div>
      </button>

      <!-- Row 1: Graph/Guide toggle (140px track). -->
      <ModeToggle v-if="graphId" />

      <!-- Graph identity: thin always-visible row (name + flags). Counts and
           the node/edge inspector moved into the Filters body to keep the
           shared header light and Contents clean. -->
      <GraphStatus v-if="graphId" section="identity" />

      <!-- Row 2: Contents/Filters toggle (210px, matches ModeToggle + footer pair). -->
      <div v-if="graphId && graphStore.mode === 'guide'"
           class="segmented-track flex items-center w-[210px] mx-auto">
        <button
          v-for="opt in MODE_OPTIONS" :key="opt.k"
          class="segmented-pill flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-xs"
          :class="sidebarMode === opt.k ? 'segmented-pill--active' : ''"
          @click="sidebars.setMode(opt.k)"
        >
          <component :is="opt.icon" :size="12" />
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </div>

    <!-- Body zone: only this scrolls. -->
    <div v-if="graphId && graphStore.mode === 'guide'"
         class="scrollbar-slim flex-1 min-h-0 overflow-y-auto px-4">
      <GuideContents v-if="sidebarMode === 'contents'" />
      <div v-else class="flex flex-col gap-3">
        <!-- 1. Summary: filtered/total counts for nodes + edges. -->
        <GraphStatus section="counts" />

        <!-- 2. Active filters: chips + undo/redo/reset. -->
        <GraphHeaderStrip />

        <!-- 3. Nodes group: selected-node inspector (when any) + node filters. -->
        <section class="flex flex-col gap-1.5">
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-secondary">Nodes</h3>
          <GraphStatus section="inspector-node" />
          <p class="text-[10px] italic text-muted">Only meaningful filters are shown.</p>
          <AttributeFilters :schema="schema" :graph-id="graphId" mode="node" />
        </section>

        <!-- 4. Edges group: selected-edge inspector (when any) + edge filters. -->
        <section class="flex flex-col gap-1.5">
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-secondary">Edges</h3>
          <GraphStatus section="inspector-edge" />
          <p class="text-[10px] italic text-muted">Only meaningful filters are shown.</p>
          <AttributeFilters :schema="schema" :graph-id="graphId" mode="edge" />
        </section>
      </div>
    </div>
    <div v-else class="flex-1"></div>

    <!-- Footer: Change dataset only. About lives in the brand block at top. -->
    <div v-if="graphId" class="shrink-0 border-t border-slate-200 px-4 py-2 flex justify-center">
      <div class="segmented-track flex items-center w-[210px]">
        <button
          class="segmented-pill flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-xs"
          :class="changeArmed ? 'segmented-pill--active text-amber-600' : ''"
          :title="changeArmed ? 'Click again to confirm' : 'Switch to a different dataset'"
          @click="onChangeDataset"
        >
          <Database :size="12" />
          <span>{{ changeArmed ? 'Click again to confirm' : 'Change dataset' }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>
