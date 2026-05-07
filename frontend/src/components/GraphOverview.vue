<script setup>
// EXTENSION: compact graph overview card — name + inline metrics
import { AlertTriangle, CheckCircle2, Repeat } from 'lucide-vue-next'

defineProps({
  name:           { type: String,  default: 'Graph' },
  nodes:          { type: Number,  default: 0 },
  edges:          { type: Number,  default: 0 },
  filteredNodes:  { type: Number,  default: null },
  filteredEdges:  { type: Number,  default: null },
  directed:       { type: Boolean, default: false },
  multigraph:     { type: Boolean, default: false },
  weighted:       { type: Boolean, default: false },
  bipartite:      { type: Boolean, default: false },
  nodeTypes:      { type: Number,  default: 0 },
  edgeTypes:      { type: Number,  default: 0 },
  selfLoops:      { type: Number,  default: 0 },
  acyclic:        { type: Boolean, default: null },
  filtersApplied: { type: Number,  default: 0 },
})

defineEmits(['reset-filters'])
</script>

<template>
  <div class="mb-6 rounded-lg bg-white px-5 py-3 shadow-sm">
    <p class="mb-1 text-sm font-semibold text-slate-800">{{ name }}</p>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <span>
        <span class="font-medium text-slate-700">{{ filteredNodes ?? nodes }}</span>
        <template v-if="filteredNodes !== null">/{{ nodes }}</template>
        nodes
      </span>
      <span class="text-slate-300">·</span>
      <span>
        <span class="font-medium text-slate-700">{{ filteredEdges ?? edges }}</span>
        <template v-if="filteredEdges !== null">/{{ edges }}</template>
        edges
      </span>
      <span class="text-slate-300">·</span>
      <span>{{ directed ? 'Directed' : 'Undirected' }}</span>
      <template v-if="multigraph">
        <span class="text-slate-300">·</span>
        <span class="inline-flex items-center gap-1"><Repeat :size="11" />Multigraph</span>
      </template>
      <span class="text-slate-300">·</span>
      <span>{{ weighted ? 'Weighted' : 'Unweighted' }}</span>
      <template v-if="bipartite">
        <span class="text-slate-300">·</span>
        <span>Bipartite</span>
      </template>
      <span class="text-slate-300">·</span>
      <span>{{ nodeTypes <= 1 ? 'Homogeneous nodes' : `${nodeTypes} node types` }}</span>
      <span class="text-slate-300">·</span>
      <span>{{ edgeTypes <= 1 ? 'Homogeneous edges' : `${edgeTypes} edge types` }}</span>
      <template v-if="selfLoops > 0">
        <span class="text-slate-300">·</span>
        <span class="inline-flex items-center gap-1 text-amber-600">
          <AlertTriangle :size="11" />
          {{ selfLoops }} self-loop{{ selfLoops > 1 ? 's' : '' }}
        </span>
      </template>
      <template v-if="acyclic === true">
        <span class="text-slate-300">·</span>
        <span class="inline-flex items-center gap-1 text-emerald-600">
          <CheckCircle2 :size="11" />
          DAG
        </span>
      </template>
      <template v-if="filtersApplied > 0">
        <span class="text-slate-300">·</span>
        <span class="text-slate-400">{{ filtersApplied }} filter{{ filtersApplied > 1 ? 's' : '' }}</span>
        <button class="text-red-400 hover:text-red-600" @click="$emit('reset-filters')">reset</button>
      </template>
    </div>
  </div>
</template>
