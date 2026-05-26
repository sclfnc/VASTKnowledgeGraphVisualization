<script setup>
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, ChevronDown, Eye, EyeOff, RotateCw, X, Check } from 'lucide-vue-next'
import { useFiltersStore } from '../stores/filters.js'
import { useSelectionStore } from '../stores/selection.js'
import { useFilterHistoryStore } from '../stores/filterHistory.js'
import { usePinsStore } from '../stores/pins.js'
import { useSchema } from '../composables/useSchema.js'
import { useNodeTypeColors } from '../composables/useNodeTypeColors.js'
import { useFilteredModel } from '../composables/useFilteredModel.js'
import NumericFilter from './NumericFilter.vue'

const SELECTION_PILL_CAP = 20

const { schema } = useSchema()
const filters = useFiltersStore()
const selection = useSelectionStore()
const filterHistory = useFilterHistoryStore()
const pins = usePinsStore()
const { color: typeColor } = useNodeTypeColors(schema)
const { activeNodeMask, activeEdgeMask } = useFilteredModel()
const filteredNodeCount = computed(() => activeNodeMask.value?.popcount() ?? schema.value?.nodes ?? 0)
const filteredEdgeCount = computed(() => activeEdgeMask.value?.popcount() ?? schema.value?.edges ?? 0)

const isolatedAlreadyFiltered = computed(() => {
  const range = filters.degree?.value
  return Array.isArray(range) && range[0] > 0
})

const hasIsolated = computed(() => (schema.value?.degree_range?.[0] ?? 1) === 0)
const hasSelfLoops = computed(() => (schema.value?.self_loops ?? 0) > 0)
const multipleNodeTypes = computed(() => (schema.value?.node_types?.length ?? 0) > 1)
const multipleEdgeTypes = computed(() => (schema.value?.edge_types?.length ?? 0) > 1)


const wccFilterLabel = computed(() => {
  const f = filters.wccFilter
  if (!f || f.length === 0) return null
  if (f.length === 1) return `WCC #${f[0] + 1}`
  return `WCC: ${f.length} components`
})

const pinnedSelectionIds = computed(() => selection.ids.slice(0, SELECTION_PILL_CAP))
const overflowSelectionCount = computed(() => Math.max(0, selection.ids.length - SELECTION_PILL_CAP))

// Dropdown open state
const nodeTypesOpen = ref(false)
const edgeTypesOpen = ref(false)

const nodeTypesLabel = computed(() => {
  const all = schema.value?.node_types?.length ?? 0
  const active = filters.nodeTypes.length
  if (all === 0) return null
  if (active === all) return 'All types'
  return `${active} / ${all} types`
})

const edgeTypesLabel = computed(() => {
  const all = schema.value?.edge_types?.length ?? 0
  const active = filters.edgeTypes.length
  if (all === 0) return null
  if (active === all) return 'All types'
  return `${active} / ${all} types`
})

function toggleType(list, value) {
  const i = list.indexOf(value)
  if (i === -1) list.push(value); else list.splice(i, 1)
}

function resetAll() {
  filters.reset(schema.value)
  selection.clear()
  pins.clearAll()
  filterHistory.clearAll()
  filterHistory.baseline()
}
</script>

<template>
  <div v-if="schema" class="card-elev rounded-2xl">

    <!-- Top bar -->
    <div class="flex items-center gap-4 border-b border-slate-200 px-4 py-2.5">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm font-semibold text-primary leading-tight">{{ schema.name ?? 'Graph' }}</span>
        <span class="text-xs text-muted">
          {{ schema.directed ? 'directed' : 'undirected' }}
          <template v-if="schema.weighted"> · weighted</template>
          <template v-if="schema.multigraph"> · multigraph</template>
          <template v-if="schema.bipartite"> · bipartite</template>
          <template v-if="schema.acyclic === true"> · DAG</template>
        </span>
      </div>

      <span v-if="filters.temporalFilter" class="flex items-center gap-1 text-xs font-medium text-sky-600">
        <span class="text-[9px] uppercase tracking-wide opacity-70">{{ filters.temporalFilter.scope ?? 'node' }}</span>
        {{ filters.temporalFilter.attr }}: {{ filters.temporalFilter.range[0] }}–{{ filters.temporalFilter.range[1] }}
        <button class="text-muted hover:text-red-400" @click="filters.temporalFilter = null"><X :size="10" /></button>
      </span>
      <span v-if="wccFilterLabel" class="flex items-center gap-1 text-xs font-medium text-violet-600">
        {{ wccFilterLabel }}
        <button class="text-muted hover:text-red-400" @click="filters.wccFilter = null"><X :size="10" /></button>
      </span>

      <span v-if="filteredNodeCount === 0" class="flex items-center gap-1 text-xs font-medium text-red-500">
        0 nodes match — adjust filters
      </span>

      <div class="ml-auto flex items-center gap-1">
        <button
          class="rounded p-1 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
          :disabled="!filterHistory.canBack"
          @click="filterHistory.back(schema)">
          <ChevronLeft :size="14" />
        </button>
        <button
          class="rounded p-1 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
          :disabled="!filterHistory.canForward"
          @click="filterHistory.forward(schema)">
          <ChevronRight :size="14" />
        </button>
        <button class="rounded px-2 py-0.5 text-xs text-secondary transition hover:text-red-500" @click="resetAll">
          Reset
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 divide-x divide-slate-200">

      <!-- NODI -->
      <section class="flex flex-col gap-3 px-4 py-3">

        <!-- Header with count -->
        <div class="flex items-baseline gap-2">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Nodes</span>
          <span class="flex items-baseline gap-1 text-xs">
            <span class="font-semibold text-primary tabular-nums">{{ filteredNodeCount.toLocaleString() }}</span>
            <span class="text-muted">/ {{ schema.nodes.toLocaleString() }}</span>
          </span>
        </div>

        <!-- Type dropdown -->
        <div class="relative">
          <p v-if="!multipleNodeTypes" class="text-xs text-muted italic">Single type — no filter</p>
          <button
            v-else
            class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-primary transition hover:border-slate-300"
            @click.stop="nodeTypesOpen = !nodeTypesOpen; edgeTypesOpen = false">
            <span :class="filters.nodeTypes.length < schema.node_types.length ? 'font-medium text-slate-700' : 'text-secondary'">
              {{ nodeTypesLabel }}
            </span>
            <ChevronDown :size="11" class="text-muted transition-transform" :class="nodeTypesOpen ? 'rotate-180' : ''" />
          </button>

          <!-- Dropdown panel -->
          <div
            v-if="nodeTypesOpen"
            class="absolute left-0 top-full z-20 mt-1 max-h-56 w-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
            @click.stop>
            <div class="p-1">
              <!-- Select all / none row -->
              <div class="flex items-center justify-between border-b border-slate-100 px-2 pb-1 mb-1">
                <button class="text-[10px] text-secondary hover:text-primary" @click="filters.nodeTypes = [...schema.node_types]">All</button>
                <button class="text-[10px] text-secondary hover:text-red-500" @click="filters.nodeTypes = []">None</button>
              </div>
              <div
                v-for="t in schema.node_types" :key="t"
                class="group flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-slate-50 transition">
                <button class="flex items-center gap-2 flex-1 text-left text-xs" @click="toggleType(filters.nodeTypes, t)">
                  <span
                    class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border"
                    :style="filters.nodeTypes.includes(t) ? { backgroundColor: typeColor(t), borderColor: typeColor(t) } : { borderColor: typeColor(t) }">
                    <Check v-if="filters.nodeTypes.includes(t)" :size="9" class="text-white" />
                  </span>
                  <span :style="{ color: typeColor(t) }" class="font-medium">{{ t }}</span>
                </button>
                <button
                  class="hidden group-hover:inline text-[9px] text-muted hover:text-primary shrink-0 transition"
                  @click.stop="filters.nodeTypes = [t]">
                  only
                </button>
              </div>
            </div>
          </div>

          <!-- Click-outside overlay -->
          <div v-if="nodeTypesOpen" class="fixed inset-0 z-10" @click="nodeTypesOpen = false" />
        </div>

        <!-- Degree + hide isolated -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <NumericFilter v-model="filters.degree" :range="schema.degree_range" label="Degree" />
          <button
            v-if="hasIsolated"
            class="flex items-center gap-1.5 text-xs transition"
            :class="isolatedAlreadyFiltered ? 'text-muted cursor-default' : filters.hideIsolated ? 'text-red-500 hover:text-red-600' : 'text-secondary hover:text-primary'"
            :title="isolatedAlreadyFiltered ? 'Already filtered by degree' : ''"
            :disabled="isolatedAlreadyFiltered"
            @click="!isolatedAlreadyFiltered && (filters.hideIsolated = !filters.hideIsolated)">
            <component :is="filters.hideIsolated || isolatedAlreadyFiltered ? EyeOff : Eye" :size="12" />
            <span>Isolated</span>
          </button>
        </div>

        <!-- Selection -->
        <div v-if="selection.ids.length" class="flex flex-col gap-1 border-t border-slate-100 pt-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-secondary">Selected</span>
            <button class="text-xs text-muted hover:text-red-400" @click="selection.clear()">clear</button>
          </div>
          <ul class="flex flex-wrap gap-1">
            <li v-for="id in pinnedSelectionIds" :key="id"
              class="flex items-center gap-1 rounded-lg surface-recessed px-2 py-0.5 text-xs text-primary">
              <span class="max-w-[7rem] truncate">{{ id }}</span>
              <button class="text-muted hover:text-red-400" @click="selection.remove(id)"><X :size="12" /></button>
            </li>
            <li v-if="overflowSelectionCount > 0"
              class="flex items-center rounded-lg surface-recessed px-2 py-0.5 text-xs text-muted">
              +{{ overflowSelectionCount }} more
            </li>
          </ul>
        </div>
      </section>

      <!-- ARCHI -->
      <section class="flex flex-col gap-3 px-4 py-3">

        <!-- Header with count -->
        <div class="flex items-baseline gap-2">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Edges</span>
          <span class="flex items-baseline gap-1 text-xs">
            <span class="font-semibold text-primary tabular-nums">{{ filteredEdgeCount.toLocaleString() }}</span>
            <span class="text-muted">/ {{ schema.edges.toLocaleString() }}</span>
          </span>
        </div>

        <!-- Edge type dropdown -->
        <div class="relative">
          <p v-if="!multipleEdgeTypes" class="text-xs text-muted italic">Single type — no filter</p>
          <button
            v-else
            class="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-primary transition hover:border-slate-300"
            @click.stop="edgeTypesOpen = !edgeTypesOpen; nodeTypesOpen = false">
            <span :class="filters.edgeTypes.length < schema.edge_types.length ? 'font-medium text-slate-700' : 'text-secondary'">
              {{ edgeTypesLabel }}
            </span>
            <ChevronDown :size="11" class="text-muted transition-transform" :class="edgeTypesOpen ? 'rotate-180' : ''" />
          </button>

          <div
            v-if="edgeTypesOpen"
            class="absolute left-0 top-full z-20 mt-1 max-h-56 w-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
            @click.stop>
            <div class="p-1">
              <div class="flex items-center justify-between border-b border-slate-100 px-2 pb-1 mb-1">
                <button class="text-[10px] text-secondary hover:text-primary" @click="filters.edgeTypes = [...schema.edge_types]">All</button>
                <button class="text-[10px] text-secondary hover:text-red-500" @click="filters.edgeTypes = []">None</button>
              </div>
              <div
                v-for="t in schema.edge_types" :key="t"
                class="group flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-slate-50 transition">
                <button class="flex items-center gap-2 flex-1 text-left text-xs" @click="toggleType(filters.edgeTypes, t)">
                  <span
                    class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-slate-300"
                    :class="filters.edgeTypes.includes(t) ? 'bg-slate-700 border-slate-700' : ''">
                    <Check v-if="filters.edgeTypes.includes(t)" :size="9" class="text-white" />
                  </span>
                  <span class="text-primary">{{ t }}</span>
                </button>
                <button
                  class="hidden group-hover:inline text-[9px] text-muted hover:text-primary shrink-0 transition"
                  @click.stop="filters.edgeTypes = [t]">
                  only
                </button>
              </div>
            </div>
          </div>

          <div v-if="edgeTypesOpen" class="fixed inset-0 z-10" @click="edgeTypesOpen = false" />
        </div>

        <!-- Weight + hide self-loops -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <NumericFilter v-if="schema.weighted" v-model="filters.weight" :range="schema.weight_range" label="Weight" />
          <button
            v-if="hasSelfLoops"
            class="flex items-center gap-1.5 text-xs transition"
            :class="filters.hideSelfLoops ? 'text-red-500 hover:text-red-600' : 'text-secondary hover:text-primary'"
            @click="filters.hideSelfLoops = !filters.hideSelfLoops">
            <RotateCw :size="12" />
            <span>Self-loops</span>
          </button>
        </div>

      </section>

    </div>
  </div>
</template>
