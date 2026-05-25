<script setup>
// Graph/Guide segmented toggle. Mounted by GuideContents (dark scope, sidebar).
// The `darkScope` prop is kept for future light-scope reuse.
import { Network, BookOpen } from 'lucide-vue-next'
import { useGraphStore } from '../stores/graph.js'

defineProps({
  darkScope: { type: Boolean, default: false },
})

const graphStore = useGraphStore()

const modes = [
  { key: 'graph', label: 'Graph', icon: Network },
  { key: 'guide', label: 'Guide', icon: BookOpen },
]
</script>

<template>
  <div
    class="segmented-track inline-flex items-center"
    :class="{ 'segmented-track--dark': darkScope }"
  >
    <button
      v-for="m in modes"
      :key="m.key"
      class="segmented-pill inline-flex items-center gap-1.5 px-3 py-0.5 text-sm"
      :class="{ 'segmented-pill--active': graphStore.mode === m.key }"
      @click="graphStore.setMode(m.key)"
    >
      <component :is="m.icon" :size="14" />
      <span>{{ m.label }}</span>
    </button>
  </div>
</template>
