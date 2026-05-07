<script setup>
// EXTENSION: filter sidebar — renders only the filters that the schema supports.
// State lives in the filters store; this component is pure UI.
// Reset of the store is handled by useSchema, not here.
import { Filter, X, Eye, EyeOff } from 'lucide-vue-next'
import { useFiltersStore } from '../stores/filters.js'
import NumericFilter from './NumericFilter.vue'

defineProps({ schema: { type: Object, default: null } })
const filters = useFiltersStore()

const toggleIn = (list, value) => {
  const i = list.indexOf(value)
  if (i === -1) list.push(value); else list.splice(i, 1)
}
</script>

<template>
  <div v-if="!schema" class="text-xs text-slate-300">No graph loaded.</div>
  <div v-else class="space-y-5">

    <section>
      <div class="mb-1 flex items-center justify-between">
        <p class="flex items-center gap-1 text-xs font-medium text-slate-600">
          <Filter :size="12" />
          <span>Selected nodes</span>
        </p>
        <button v-if="filters.selected.length" class="text-[10px] text-slate-400 hover:text-red-400" @click="filters.selected = []">clear</button>
      </div>
      <div v-if="!filters.selected.length" class="rounded border border-dashed border-slate-200 px-2 py-1.5 text-[10px] text-slate-400">
        Click a node or use search.
      </div>
      <ul v-else class="flex flex-wrap gap-1">
        <li v-for="(id, i) in filters.selected" :key="id" class="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
          <span class="max-w-[7rem] truncate">{{ id }}</span>
          <button class="text-slate-400 hover:text-red-400" @click="filters.selected.splice(i, 1)"><X :size="10" /></button>
        </li>
      </ul>
      <div v-if="filters.selected.length" class="mt-2">
        <div class="flex items-center justify-between text-[10px] text-slate-500">
          <span>Neighborhood</span>
          <span>{{ filters.hops === -1 ? 'all' : `${filters.hops}-hop` }}</span>
        </div>
        <input type="range" min="-1" max="5" v-model.number="filters.hops" class="w-full">
        <div class="flex justify-between text-[9px] text-slate-400">
          <span>all</span><span>0</span><span>5</span>
        </div>
      </div>
    </section>

    <section>
      <button
        class="flex items-center gap-1.5 text-[11px] transition"
        :class="filters.hideIsolated ? 'text-red-500 hover:text-red-600' : 'text-slate-500 hover:text-slate-700'"
        @click="filters.hideIsolated = !filters.hideIsolated"
      >
        <component :is="filters.hideIsolated ? EyeOff : Eye" :size="13" />
        <span>{{ filters.hideIsolated ? 'Isolated nodes hidden' : 'Isolated nodes visible' }}</span>
      </button>
    </section>

    <section v-if="schema.node_types?.length">
      <p class="mb-1 text-xs font-medium text-slate-600">Node types</p>
      <ul class="space-y-0.5">
        <li v-for="t in schema.node_types" :key="t" class="flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" :checked="filters.nodeTypes.includes(t)" @change="toggleIn(filters.nodeTypes, t)">
          <span>{{ t }}</span>
        </li>
      </ul>
    </section>

    <section v-if="schema.edge_types?.length">
      <p class="mb-1 text-xs font-medium text-slate-600">Edge types</p>
      <ul class="space-y-0.5">
        <li v-for="t in schema.edge_types" :key="t" class="flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" :checked="filters.edgeTypes.includes(t)" @change="toggleIn(filters.edgeTypes, t)">
          <span>{{ t }}</span>
        </li>
      </ul>
    </section>

    <NumericFilter v-model="filters.degree" :range="schema.degree_range" label="Degree" />

    <NumericFilter v-if="schema.weighted" v-model="filters.weight" :range="schema.weight_range" label="Edge weight" />

    <section v-if="schema.attributes?.length">
      <p class="mb-1 text-xs font-medium text-slate-600">Attributes</p>
      <div class="space-y-3">
        <div v-for="a in schema.attributes" :key="a.name">
          <NumericFilter
            v-if="a.kind === 'numeric'"
            v-model="filters.attributes[a.name]"
            :range="a.range"
            :label="a.name"
          />
          <div v-else-if="a.kind === 'categorical' && a.values?.length">
            <p class="mb-0.5 text-[11px] font-medium text-slate-600">{{ a.name }}</p>
            <ul class="max-h-32 space-y-0.5 overflow-y-auto pr-1">
              <li v-for="v in a.values" :key="v" class="flex items-center gap-1 text-[11px] text-slate-600">
                <input type="checkbox" :checked="filters.attributes[a.name]?.includes(v)" @change="toggleIn(filters.attributes[a.name], v)">
                <span class="truncate">{{ v }}</span>
              </li>
            </ul>
            <p v-if="a.truncated" class="text-[10px] text-slate-400">first 50 values shown</p>
          </div>
          <div v-else-if="a.kind === 'boolean'" class="flex items-center gap-1 text-[11px] text-slate-600">
            <span class="font-medium">{{ a.name }}</span>
            <!-- boolean shown as tri-state via categorical multi-select -->
          </div>
        </div>
      </div>
    </section>

  </div>
</template>
