<script setup>
import { storeToRefs } from 'pinia'
import { useGraphStore } from '../stores/graph.js'
import { injectSchema } from '../composables/useSchema.js'
import GraphStatus from '@/components/GraphStatus.vue'
import GraphHeaderStrip from '@/components/GraphHeaderStrip.vue'
import AttributeFilters from '../panels/AttributeFilters.vue'

const graphStore = useGraphStore()
const { graphId } = storeToRefs(graphStore)
const { schema } = injectSchema()

</script>

<template>
  <!-- Body zone: only this scrolls. -->
  <div class="scrollbar-slim flex-1 min-h-0 overflow-y-auto px-4">
    <div v-if="graphId"
      class="scrollbar-slim flex-1 min-h-0 overflow-y-auto px-4">
      <div class="flex flex-col gap-3">
        <!-- 1. Summary: filtered/total counts for nodes + edges. -->
        <GraphStatus section="counts" />

        <!-- 2. Active filters: chips + undo/redo/reset. -->
        <GraphHeaderStrip />
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