<script setup>
import { ref, computed } from 'vue'
import { ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, RotateCw, X } from 'lucide-vue-next'
import { useFiltersStore } from '../stores/filters.js'
import { useSelectionStore } from '../stores/selection.js'
import { useFilterHistoryStore } from '../stores/filterHistory.js'
import { usePinsStore } from '../stores/pins.js'
import { useSchema } from '../composables/useSchema.js'
import { useNodeTypeColors } from '../composables/useNodeTypeColors.js'
import { formatAttrSummary, formatCoverage } from '../panels/shared.js'
import NumericFilter from './NumericFilter.vue'

// Presentation cap for the Selected pill list. The selection store itself
// stays unbounded (a single click on an aggregate mark may seed thousands of
// ids); the cap only protects the DOM from blowing up.
const SELECTION_PILL_CAP = 20

const { schema } = useSchema()
const filters = useFiltersStore()
const selection = useSelectionStore()
const filterHistory = useFilterHistoryStore()
const pins = usePinsStore()
const { color: typeColor } = useNodeTypeColors(schema)

// Per-column attribute breakdown expand state. Independent so the user can
// reveal Nodi attrs without dragging in the (often empty) Edge column.
//
// Future hook: when selection.ids.length === 1 the Nodi column should swap
// into a node-specific mode showing the selected node's actual attribute
// values instead of the global per-type summary. Additive — no rewrite.
const nodesAttrsOpen = ref(false)
const edgesAttrsOpen = ref(false)

const hasEdgeAttrs = computed(() =>
  (schema.value?.edge_types_detail ?? []).some(t => t.attributes.length > 0)
)

// Diff against the post-reset defaults: each line appears only when the
// filter diverges from the schema-derived baseline. Empty list → "No filters".
const filtersSummary = computed(() => {
  const s = schema.value
  if (!s) return ''
  const parts = []
  const totalNT = (s.node_types ?? []).length
  if (filters.nodeTypes.length !== totalNT) parts.push(`${filters.nodeTypes.length}/${totalNT} node types`)
  const totalET = (s.edge_types ?? []).length
  if (totalET > 0 && filters.edgeTypes.length !== totalET) parts.push(`${filters.edgeTypes.length}/${totalET} edge types`)
  const [dMin, dMax] = filters.degree.value
  const [d0, d1] = s.degree_range ?? [0, 0]
  if (dMin > d0) parts.push(`Degree ≥ ${dMin}`)
  if (dMax < d1) parts.push(`Degree ≤ ${dMax}`)
  if (s.weighted) {
    const [wMin, wMax] = filters.weight.value
    const [w0, w1] = s.weight_range ?? [0, 0]
    if (wMin > w0) parts.push(`Weight ≥ ${wMin}`)
    if (wMax < w1) parts.push(`Weight ≤ ${wMax}`)
  }
  if (filters.hideIsolated) parts.push('Hide isolated')
  if (filters.hideSelfLoops) parts.push('Hide self-loops')
  if (filters.temporalFilter) {
    const [a, b] = filters.temporalFilter.range
    parts.push(`${filters.temporalFilter.attr} ${a}–${b}`)
  }
  return parts.length === 0 ? 'No filters' : `Filters: ${parts.join(' · ')}`
})

const pinnedSelectionIds = computed(() => selection.ids.slice(0, SELECTION_PILL_CAP))
const overflowSelectionCount = computed(() => Math.max(0, selection.ids.length - SELECTION_PILL_CAP))

function nodeChipStyle(t, selected) {
  const c = typeColor(t)
  if (selected) return { backgroundColor: `${c}20`, borderColor: c, color: c }
  return { borderColor: c, color: c }
}

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
  <div v-if="schema" class="card-elev rounded-2xl overflow-hidden">

    <!-- Caption row: filter summary + undo/redo + Reset all. -->
    <div class="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
      <span class="flex-1 truncate text-xs text-secondary">{{ filtersSummary }}</span>
      <div class="flex items-center gap-1">
        <button
          class="rounded p-1 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-secondary"
          :disabled="!filterHistory.canBack"
          aria-label="Undo filter change"
          @click="filterHistory.back(schema)">
          <ChevronLeft :size="14" />
        </button>
        <button
          class="rounded p-1 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-secondary"
          :disabled="!filterHistory.canForward"
          aria-label="Redo filter change"
          @click="filterHistory.forward(schema)">
          <ChevronRight :size="14" />
        </button>
        <button
          class="rounded px-2 py-0.5 text-xs text-secondary transition hover:text-red-500"
          @click="resetAll">
          Reset all
        </button>
      </div>
    </div>

    <div class="grid grid-cols-[1fr_2fr]">

      <!-- Generale -->
      <div class="flex flex-col gap-2 px-4 py-3">
        <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Generale</span>
        <p class="text-sm font-bold text-primary leading-tight">{{ schema.name ?? 'Graph' }}</p>
        <div class="flex flex-col gap-0.5 text-xs text-secondary">
          <span><span class="font-semibold text-primary">{{ schema.nodes.toLocaleString() }}</span> nodi</span>
          <span><span class="font-semibold text-primary">{{ schema.edges.toLocaleString() }}</span> archi</span>
          <span>{{ schema.directed ? 'Directed' : 'Undirected' }}</span>
          <span v-if="schema.multigraph">Multigraph</span>
          <span v-if="schema.acyclic === true">DAG</span>
          <span v-if="schema.bipartite">Bipartite</span>
          <span v-if="filters.temporalFilter" class="text-sky-600 font-medium flex items-center gap-1">
            {{ filters.temporalFilter.attr }}: {{ filters.temporalFilter.range[0] }}–{{ filters.temporalFilter.range[1] }}
            <button class="text-muted hover:text-red-400"
                    aria-label="Clear temporal filter"
                    @click="filters.temporalFilter = null">
              <X :size="10" />
            </button>
          </span>
        </div>
      </div>

      <!-- Nodi + Archi: each column owns chips, filters, attr breakdown (and selection for Nodi) -->
      <div class="flex divide-x divide-slate-200 border-l border-slate-200">

        <!-- Nodi -->
        <section class="flex flex-1 flex-col gap-2 px-4 py-3">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Nodi</span>
          <div v-if="schema.node_types?.length" class="flex flex-wrap gap-1">
            <button
              v-for="t in schema.node_types" :key="t"
              class="type-chip px-2 py-0.5 text-xs font-medium"
              :style="nodeChipStyle(t, filters.nodeTypes.includes(t))"
              @click="toggleType(filters.nodeTypes, t)">
              {{ t }}
            </button>
          </div>
          <div class="flex flex-wrap items-end gap-x-4 gap-y-1.5">
            <NumericFilter v-model="filters.degree" :range="schema.degree_range" label="Degree" />
            <button
              class="flex items-center gap-1.5 text-xs transition"
              :class="filters.hideIsolated ? 'text-red-500 hover:text-red-600' : 'text-secondary hover:text-primary'"
              @click="filters.hideIsolated = !filters.hideIsolated">
              <component :is="filters.hideIsolated ? EyeOff : Eye" :size="12" />
              <span>Isolated</span>
            </button>
          </div>

          <!-- Attribute breakdown (collapsible) -->
          <button
            class="flex items-center gap-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted transition hover:text-primary"
            @click="nodesAttrsOpen = !nodesAttrsOpen">
            <component :is="nodesAttrsOpen ? ChevronDown : ChevronRight" :size="12" />
            <span>Attributes</span>
          </button>
          <div v-if="nodesAttrsOpen" class="flex flex-col gap-2 border-t border-slate-200 pt-2">
            <div v-for="t in schema.node_types_detail" :key="t.name" class="flex flex-col gap-1">
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-bold" :style="{ color: typeColor(t.name) }">{{ t.name }}</span>
                <span class="text-[10px] text-muted tabular-nums">{{ t.count.toLocaleString() }}</span>
              </div>
              <ul v-if="t.attributes.length" class="flex flex-col gap-0.5 pl-2 text-[11px]">
                <li v-for="a in t.attributes" :key="a.name" class="flex flex-wrap items-baseline gap-x-1.5">
                  <span class="font-medium text-primary">{{ a.name }}</span>
                  <span class="text-[9px] uppercase tracking-wide text-muted">{{ a.kind }}</span>
                  <span class="text-[10px] text-muted tabular-nums">{{ formatCoverage(a.coverage) }}</span>
                  <span class="truncate text-secondary" :title="formatAttrSummary(a)">
                    · {{ formatAttrSummary(a) }}
                  </span>
                </li>
              </ul>
              <span v-else class="pl-2 text-[10px] italic text-muted">no extra attributes</span>
            </div>
          </div>

          <div v-if="selection.ids.length" class="flex flex-col gap-1 border-t border-slate-200 pt-2">
            <div class="flex items-center justify-between gap-4">
              <span class="text-xs font-medium text-secondary">Selected</span>
              <button class="text-xs text-muted hover:text-red-400" @click="selection.clear()">clear</button>
            </div>
            <ul class="flex flex-wrap gap-1">
              <li v-for="id in pinnedSelectionIds" :key="id" class="flex items-center gap-1 rounded-lg surface-recessed px-2 py-0.5 text-xs text-primary">
                <span class="max-w-[7rem] truncate">{{ id }}</span>
                <button class="text-muted hover:text-red-400" @click="selection.remove(id)"><X :size="12" /></button>
              </li>
              <li v-if="overflowSelectionCount > 0" class="flex items-center rounded-lg surface-recessed px-2 py-0.5 text-xs text-muted">
                +{{ overflowSelectionCount }} more
              </li>
            </ul>
          </div>
        </section>

        <!-- Archi -->
        <section class="flex flex-1 flex-col gap-2 px-4 py-3">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-muted">Archi</span>
          <div v-if="schema.edge_types?.length" class="flex flex-wrap gap-1">
            <button
              v-for="t in schema.edge_types" :key="t"
              class="type-chip px-2 py-0.5 text-xs font-medium"
              :class="{ 'type-chip--active': filters.edgeTypes.includes(t) }"
              @click="toggleType(filters.edgeTypes, t)">
              {{ t }}
            </button>
          </div>
          <div class="flex flex-wrap items-end gap-x-4 gap-y-1.5">
            <NumericFilter v-if="schema.weighted" v-model="filters.weight" :range="schema.weight_range" label="Weight" />
            <button
              class="flex items-center gap-1.5 text-xs transition"
              :class="filters.hideSelfLoops ? 'text-red-500 hover:text-red-600' : 'text-secondary hover:text-primary'"
              @click="filters.hideSelfLoops = !filters.hideSelfLoops">
              <RotateCw :size="12" />
              <span>Self-loops</span>
            </button>
          </div>

          <!-- Attribute breakdown (collapsible) -->
          <button
            class="flex items-center gap-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted transition hover:text-primary"
            @click="edgesAttrsOpen = !edgesAttrsOpen">
            <component :is="edgesAttrsOpen ? ChevronDown : ChevronRight" :size="12" />
            <span>Attributes</span>
          </button>
          <div v-if="edgesAttrsOpen" class="flex flex-col gap-2 border-t border-slate-200 pt-2">
            <div v-if="!hasEdgeAttrs" class="text-[11px] italic text-muted">
              No additional edge attributes — all edges carry only Edge Type.
            </div>
            <template v-else>
              <div v-for="t in schema.edge_types_detail" :key="t.name" class="flex flex-col gap-1">
                <div class="flex items-baseline gap-2">
                  <span class="text-xs font-bold text-primary">{{ t.name }}</span>
                  <span class="text-[10px] text-muted tabular-nums">{{ t.count.toLocaleString() }}</span>
                </div>
                <ul v-if="t.attributes.length" class="flex flex-col gap-0.5 pl-2 text-[11px]">
                  <li v-for="a in t.attributes" :key="a.name" class="flex flex-wrap items-baseline gap-x-1.5">
                    <span class="font-medium text-primary">{{ a.name }}</span>
                    <span class="text-[9px] uppercase tracking-wide text-muted">{{ a.kind }}</span>
                    <span class="text-[10px] text-muted tabular-nums">{{ formatCoverage(a.coverage) }}</span>
                    <span class="truncate text-secondary" :title="formatAttrSummary(a)">
                      · {{ formatAttrSummary(a) }}
                    </span>
                  </li>
                </ul>
                <span v-else class="pl-2 text-[10px] italic text-muted">no extra attributes</span>
              </div>
            </template>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>
