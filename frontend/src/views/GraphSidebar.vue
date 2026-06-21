<script setup>
import { storeToRefs } from 'pinia'
import { useGraphStore } from '../stores/graph.js'
import SidebarFilters from '@/components/SidebarFilters.vue'

const graphStore = useGraphStore()
const { graphId } = storeToRefs(graphStore)

</script>

<template>
  <!-- Body zone: only this scrolls. -->
  <div class="scrollbar-slim flex-1 min-h-0 overflow-y-auto px-4">
    <div v-if="graphId"
      class="scrollbar-slim flex-1 min-h-0 overflow-y-auto px-4 mt-2">
      <SidebarFilters :edges-first="true" />
    </div>
  </div>
</template>