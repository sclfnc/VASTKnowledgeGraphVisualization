<script setup>
// Graph/Guide segmented toggle. Light theme only — the previous dark-scope
// prop was never wired by any consumer after the sidebar refactor.
import { Network, BookOpen } from 'lucide-vue-next'
import { useGraphStore } from '../stores/graph.js'

const graphStore = useGraphStore()

const modes = [
  { key: 'graph', label: 'Graph', icon: Network },
  { key: 'guide', label: 'Guide', icon: BookOpen },
]
</script>

<template>
  <div class="segmented-track flex items-center w-[210px] mx-auto">
    <button
      v-for="m in modes"
      :key="m.key"
      class="segmented-pill flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-xs"
      :class="{ 'segmented-pill--active': graphStore.mode === m.key }"
      @click="graphStore.setMode(m.key)"
    >
      <component :is="m.icon" :size="12" />
      <span>{{ m.label }}</span>
    </button>
  </div>
</template>
