<script setup>
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ListTree, SlidersHorizontal } from 'lucide-vue-next'
import { useGraphStore } from '../stores/graph.js'
import { useSidebarsStore } from '../stores/sidebars.js'
import { useSelectionStore } from '../stores/selection.js'
import { injectSchema } from '../composables/useSchema.js'
import GuideContents from '@/components/GuideContents.vue'
import GraphStatus from '@/components/GraphStatus.vue'
import GraphHeaderStrip from '@/components/GraphHeaderStrip.vue'
import AttributeFilters from '../panels/AttributeFilters.vue'

const graphStore = useGraphStore()
const sidebars = useSidebarsStore()
const selection = useSelectionStore()
const { mode: sidebarMode } = storeToRefs(sidebars)
const { graphId } = storeToRefs(graphStore)
const { ids: selectedIds, edgeIds: selectedEdgeIds } = storeToRefs(selection)
const { schema } = injectSchema()

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
  { k: 'filters', label: 'Filters', icon: SlidersHorizontal },
]
</script>

<template>
  <!-- <ModeToggle v-if="graphId" /> -->
  <header class="shrink-0 px-4 pt-3 pb-2 flex flex-col gap-2">
    <div v-if="graphId"
      class="segmented-track flex items-center w-[210px] mx-auto">
      <button
        v-for="opt in MODE_OPTIONS" :key="opt.k"
        class="segmented-pill flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-xs"
        :class="sidebarMode === opt.k ? 'segmented-pill--active' : ''"
        @click="sidebars.setMode(opt.k)">
        <component :is="opt.icon" :size="12" />
        <span>{{ opt.label }}</span>
      </button>
    </div>
  </header>
  <!-- Body zone: only this scrolls. -->
  <div class="scrollbar-slim flex-1 min-h-0 overflow-y-auto px-4">
    <div v-if="graphId"
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
  </div>

</template>