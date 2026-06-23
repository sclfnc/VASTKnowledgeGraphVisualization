<script setup>
import { injectSchema } from '@/composables/useSchema'
import { useGraphStore } from '@/stores/graph'
import { storeToRefs } from 'pinia'
import GraphStatus from './GraphStatus.vue'
import AttributeFilters from '@/panels/AttributeFilters.vue'
import GraphHeaderStrip from './GraphHeaderStrip.vue'

const graphStore = useGraphStore()
const { graphId } = storeToRefs(graphStore)
const { schema } = injectSchema()

defineProps({
  edgesFirst: {
    type: Boolean,
    default: false
  }
})

</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 1. Summary: filtered/total counts for nodes + edges. -->
    <GraphStatus section="counts" />

    <!-- 2. Active filters: chips + undo/redo/reset. -->
    <GraphHeaderStrip />

    <!-- 3. Nodes group: selected-node inspector (when any) + node filters. -->
    <section class="flex flex-col gap-1.5"
      :class="{ 'order-2': edgesFirst }">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-secondary">Nodes</h3>
      <GraphStatus section="inspector-node" />
      <p class="text-[10px] italic text-muted">Only meaningful filters are shown.</p>
      <AttributeFilters :schema="schema" :graph-id="graphId" mode="node" />
    </section>

    <!-- 4. Edges group: selected-edge inspector (when any) + edge filters. -->
    <section class="flex flex-col gap-1.5"
      :class="{ 'order-1': edgesFirst }">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-secondary">Edges</h3>
      <GraphStatus section="inspector-edge" />
      <p class="text-[10px] italic text-muted">Only meaningful filters are shown.</p>
      <AttributeFilters :schema="schema" :graph-id="graphId" mode="edge" />
    </section>
  </div>
</template>