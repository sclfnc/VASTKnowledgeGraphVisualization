<script setup>
// Parametric panel: `mode: 'node' | 'edge'` decides which side of the
// attribute index drives the accordion. Writes per-type constraints into
// filters.nodeAttrs (or filters.edgeAttrs); the v2 AND-chain in
// useFilteredModel picks them up and propagates as masks.
//
// Layout: one accordion item per type (auto-promoted or raw). Each item
// expands to its filterable attributes (skipped attrs from D-i/identifier
// heuristics are not shown). Per-attr widget chosen by kind:
//   categorical → chip multi-select (values from index.values)
//   numeric     → dual range slider (min/max from index.range)
//   boolean     → tri-state toggle (Any / True / False)
//   temporal    → dual range slider on years (range from index.range)
//
// Footer: "N active filters · Clear all".
import { computed, ref, toRef } from 'vue'
import { ChevronRight, X, Eye, EyeOff, RotateCw, Search } from 'lucide-vue-next'
import { injectAttributeIndex } from '@/composables/useAttributeIndex.js'
import { injectGraphNodes } from '@/composables/useGraphNodes.js'
import { injectGraphEdges } from '@/composables/useGraphEdges.js'
import { useEffectiveType } from '@/composables/useEffectiveType.js'
import { useNodeTypeColors } from '@/composables/useNodeTypeColors.js'
import { useFiltersStore } from '@/stores/filters.js'
import { formatAttrSummary, formatCoverage } from './shared.js'
import RangeFilter from './controls/RangeFilter.vue'

const props = defineProps({
  schema: { type: Object, default: null },
  graphId: { type: String, default: null },
  mode: { type: String, default: 'node' },   // 'node' | 'edge'
})

const filters = useFiltersStore()
const { attrsFor, hasAttrsFor, ready } = injectAttributeIndex(toRef(props, 'graphId'))
const { nodes: nodesSoA } = injectGraphNodes(toRef(props, 'graphId'))
const { edges: edgesSoA } = injectGraphEdges(toRef(props, 'graphId'))
const { nodeTypeList, edgeTypeList, nodeTypeAt, edgeTypeAt } = useEffectiveType(toRef(props, 'graphId'), toRef(props, 'schema'))
const { color: typeColor } = useNodeTypeColors(toRef(props, 'schema'))

// Per-type counts (using effective labels). Rebuilt when SoA or effective
// labels change — both keyed on graphId, so a graph switch invalidates them.
const nodeTypeCounts = computed(() => {
  const soa = nodesSoA.value
  if (!soa) return {}
  const out = {}
  for (let i = 0; i < soa.N; i++) {
    const t = nodeTypeAt(i)
    out[t] = (out[t] || 0) + 1
  }
  return out
})
const edgeTypeCounts = computed(() => {
  const soa = edgesSoA.value
  if (!soa) return {}
  const out = {}
  for (let i = 0; i < soa.E; i++) {
    const t = edgeTypeAt(i) ?? soa.edgeTypes[soa.type[i]]
    out[t] = (out[t] || 0) + 1
  }
  return out
})

// UI-only display mode for range filters: 'absolute' vs 'percentile'. The
// stored filter spec is always absolute; mode just toggles how the slider
// and the input boxes are rendered.
const MODE_OPTIONS = [
  { k: 'absolute',   label: 'Abs' },
  { k: 'percentile', label: '%' },
]
const degreeMode = ref('absolute')
const weightMode = ref('absolute')
const attrModes = ref({})    // key: `${type}:${attr}` → 'absolute'|'percentile'
function getAttrMode(t, attr) { return attrModes.value[`${t}:${attr}`] ?? 'absolute' }
function setAttrMode(t, attr, m) { attrModes.value = { ...attrModes.value, [`${t}:${attr}`]: m } }

// Descriptive metadata (coverage + value summary) for the "understand" layer of
// the accordion — sourced from schema.*_types_detail, not the filter index.
// This is what made the standalone Attribute Schema panel redundant: the same
// "what does this attribute look like?" info now lives next to the control.
const typesDetail = computed(() =>
  props.schema?.[isEdge.value ? 'edge_types_detail' : 'node_types_detail'] ?? []
)
function attrMeta(type, attr) {
  const t = typesDetail.value.find(d => d.name === type)
  return t?.attributes.find(a => a.name === attr) ?? null
}
function attrCoverage(type, attr) {
  const m = attrMeta(type, attr)
  return m ? formatCoverage(m.coverage) : null
}
function attrSummary(type, attr) {
  const m = attrMeta(type, attr)
  return m ? formatAttrSummary(m) : null
}

// Top-level type chip group: visualization cap + sort + expand-all toggle.
const TYPE_CHIP_CAP = 6
const SORT_OPTIONS = [
  { k: 'count', label: '9→1' },   // cardinality desc — symmetric with A→Z label
  { k: 'alpha', label: 'A→Z' },
]
const typeSort = ref('count')
const typeExpanded = ref(false)

const typeCounts = computed(() => isEdge.value ? edgeTypeCounts.value : nodeTypeCounts.value)

const sortedTypes = computed(() => {
  const all = [...types.value]
  if (typeSort.value === 'alpha') return all.sort((a, b) => String(a).localeCompare(String(b)))
  const counts = typeCounts.value
  return all.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || String(a).localeCompare(String(b)))
})

const visibleTypes = computed(() => {
  if (typeExpanded.value || sortedTypes.value.length <= TYPE_CHIP_CAP) return sortedTypes.value
  return sortedTypes.value.slice(0, TYPE_CHIP_CAP)
})

const hiddenTypesCount = computed(() => Math.max(0, sortedTypes.value.length - visibleTypes.value.length))

// Per-type accordion: only types with at least one filterable attribute are
// shown. Type without filterable attrs would just render an empty card with
// "no filterable attrs" — noisy. The disclaimer caption (below the title)
// explains the omission for users who'd expect every type to appear.
const filterableTypes = computed(() => types.value.filter(t => hasAttrsFor(scope.value, t)))

const scope = computed(() => props.mode === 'edge' ? 'edge' : 'node')
const storeKey = computed(() => props.mode === 'edge' ? 'edgeAttrs' : 'nodeAttrs')
const isEdge = computed(() => props.mode === 'edge')

const types = computed(() => {
  const list = props.mode === 'edge' ? edgeTypeList.value : nodeTypeList.value
  if (list.length) return list
  return props.mode === 'edge'
    ? (props.schema?.edge_types ?? [])
    : (props.schema?.node_types ?? [])
})

// Track which type accordions are open (local UI state, panel-scoped).
const openTypes = ref(new Set())
function toggleType(t) {
  const next = new Set(openTypes.value)
  if (next.has(t)) next.delete(t); else next.add(t)
  openTypes.value = next
}

const activeFilterCount = computed(() => {
  let n = 0
  for (const constraints of Object.values(filters[storeKey.value] || {})) {
    n += Object.keys(constraints).length
  }
  return n
})

function getSpec(type, attr) {
  return filters[storeKey.value]?.[type]?.[attr]
}

function setSpec(type, attr, spec) {
  if (isEdge.value) filters.setEdgeAttr(type, attr, spec)
  else filters.setNodeAttr(type, attr, spec)
}

function clearSpec(type, attr) {
  setSpec(type, attr, null)
}

function clearAll() {
  if (isEdge.value) filters.clearEdgeAttrs(null)
  else filters.clearNodeAttrs(null)
}

// Categorical handlers ---------------------------------------------------
function isCategoricalActive(type, attr, value) {
  const spec = getSpec(type, attr)
  if (!spec || spec.kind !== 'categorical') return false
  return spec.values.includes(value)
}

function toggleCategorical(type, attr, value) {
  const spec = getSpec(type, attr)
  const cur = spec?.values ?? []
  const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value]
  if (next.length === 0) clearSpec(type, attr)
  else setSpec(type, attr, { kind: 'categorical', values: next })
}

// Numeric / temporal handlers -------------------------------------------
function getRange(type, attr) {
  const spec = getSpec(type, attr)
  return spec?.range ?? null
}

function setRange(type, attr, kind, range, fullRange) {
  // Drop the spec entirely if the range matches the full domain (no-op filter).
  // Tolerance-based comparison: slider step rounding can leave sub-unit deltas
  // on float ranges that strict `===` would treat as "not-full" and persist a
  // useless filter.
  const eps = Math.max(1e-9, (fullRange[1] - fullRange[0]) * 1e-6)
  if (Math.abs(range[0] - fullRange[0]) <= eps && Math.abs(range[1] - fullRange[1]) <= eps) {
    clearSpec(type, attr)
  } else {
    setSpec(type, attr, { kind, range })
  }
}

// Boolean handlers ------------------------------------------------------
function getBooleanValue(type, attr) {
  const spec = getSpec(type, attr)
  if (!spec || spec.kind !== 'boolean') return 'any'
  return spec.value ? 'true' : 'false'
}

function setBooleanValue(type, attr, choice) {
  if (choice === 'any') clearSpec(type, attr)
  else setSpec(type, attr, { kind: 'boolean', value: choice === 'true' })
}

// Text handlers (high-cardinality identifiers) ---------------------------
function getTextQuery(type, attr) {
  const spec = getSpec(type, attr)
  return (spec && spec.kind === 'text') ? (spec.query ?? '') : ''
}
function getTextMode(type, attr) {
  const spec = getSpec(type, attr)
  return (spec && spec.kind === 'text') ? (spec.mode ?? 'contains') : 'contains'
}
function setTextQuery(type, attr, query) {
  const q = (query ?? '').trim()
  if (!q) clearSpec(type, attr)
  else setSpec(type, attr, { kind: 'text', query: q, mode: getTextMode(type, attr) })
}
function setTextMode(type, attr, mode) {
  const q = getTextQuery(type, attr)
  if (!q) return   // mode is meaningless without a query
  setSpec(type, attr, { kind: 'text', query: q, mode })
}

const TEXT_MODE_OPTIONS = [
  { k: 'contains', label: 'contains' },
  { k: 'equals', label: 'exact' },
]

// Type chip group (top-level filter, distinct from per-type attr filters).
const selectedTypesList = computed(() => isEdge.value ? filters.edgeTypes : filters.nodeTypes)

function toggleTopType(t) {
  const list = isEdge.value ? filters.edgeTypes : filters.nodeTypes
  const next = list.includes(t) ? list.filter(x => x !== t) : [...list, t]
  if (isEdge.value) filters.edgeTypes = next
  else filters.nodeTypes = next
}

function selectAllTopTypes() {
  if (isEdge.value) filters.edgeTypes = [...types.value]
  else filters.nodeTypes = [...types.value]
}

function clearTopTypes() {
  if (isEdge.value) filters.edgeTypes = []
  else filters.nodeTypes = []
}

// Structural toggles + ranges (only shown on the side that owns them).
const hasIsolated = computed(() => (props.schema?.degree_range?.[0] ?? 1) === 0)
const hasSelfLoops = computed(() => (props.schema?.self_loops ?? 0) > 0)
const isolatedAlreadyFiltered = computed(() => {
  const range = filters.degree?.value
  return Array.isArray(range) && range[0] > 0
})
</script>

<template>
  <div class="flex flex-col gap-1 h-full overflow-auto">
    <div v-if="!ready" class="text-xs text-muted px-1 py-2">Loading attribute index…</div>

    <template v-else>
      <!-- Header summary -->
      <div class="flex items-center justify-between px-1 py-1.5 text-xs">
        <span class="text-secondary">
          <strong class="text-primary">{{ activeFilterCount }}</strong>
          active filter{{ activeFilterCount === 1 ? '' : 's' }}
        </span>
        <button
          v-if="activeFilterCount > 0"
          class="text-[10px] text-secondary hover:text-red-500 inline-flex items-center gap-0.5"
          @click="clearAll"
        >
          <X :size="10" /> Clear all
        </button>
      </div>

      <!-- Type chip group (top-level: which types pass at all). -->
      <div v-if="types.length > 1" class="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {{ isEdge ? 'Edge Type' : 'Node Type' }}
          </span>
          <div class="flex items-center gap-2">
            <!-- Sort toggle: by cardinality (default) or alphabetic. -->
            <div class="segmented-track flex items-center" :title="'Sort chips by cardinality or alphabetically'">
              <button
                v-for="opt in SORT_OPTIONS" :key="opt.k"
                class="segmented-pill inline-flex items-center justify-center px-1.5 py-0 text-[9px]"
                :class="typeSort === opt.k ? 'segmented-pill--active' : ''"
                @click="typeSort = opt.k"
              >{{ opt.label }}</button>
            </div>
            <div class="flex gap-2 text-[10px]">
              <button class="text-secondary hover:text-primary" @click="selectAllTopTypes">All</button>
              <button class="text-secondary hover:text-red-500" @click="clearTopTypes">None</button>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="t in visibleTypes" :key="t"
            class="type-chip text-[10px] px-1.5 py-0"
            :class="{ 'type-chip--active': selectedTypesList.includes(t) }"
            :style="selectedTypesList.includes(t)
              ? { backgroundColor: typeColor(t) + '22', borderColor: typeColor(t), color: typeColor(t) }
              : { borderColor: typeColor(t), color: typeColor(t) }"
            @click="toggleTopType(t)"
          >
            {{ t }}
            <span class="opacity-60 ml-0.5">· {{ typeCounts[t] ?? 0 }}</span>
          </button>
          <!-- "+N more" / "Show less" toggle. -->
          <button
            v-if="hiddenTypesCount > 0 || typeExpanded"
            class="type-chip text-[10px] px-1.5 py-0 text-secondary border-slate-300"
            @click="typeExpanded = !typeExpanded"
          >{{ typeExpanded ? 'Show less' : `+${hiddenTypesCount} more` }}</button>
        </div>
      </div>

      <!-- Node side: Degree filtering -->
      <template v-if="!isEdge">
        <div v-if="schema?.degree_range" class="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-semibold uppercase tracking-wide text-muted">Degree filtering</span>
            <div class="segmented-track flex items-center">
              <button
                v-for="opt in MODE_OPTIONS" :key="opt.k"
                class="segmented-pill inline-flex items-center justify-center px-1.5 py-0 text-[10px]"
                :class="degreeMode === opt.k ? 'segmented-pill--active' : ''"
                @click="degreeMode = opt.k"
              >{{ opt.label }}</button>
            </div>
          </div>
          <RangeFilter
            :model-value="filters.degree?.value ?? schema.degree_range"
            :full-range="schema.degree_range"
            :step="1"
            :mode="degreeMode"
            @update:model-value="(v) => filters.degree = { mode: 'absolute', value: v }"
          />
          <button
            v-if="hasIsolated"
            class="text-[10px] flex items-center gap-1 transition self-start"
            :class="isolatedAlreadyFiltered ? 'text-muted cursor-default'
              : filters.hideIsolated ? 'text-red-500' : 'text-secondary hover:text-primary'"
            :disabled="isolatedAlreadyFiltered"
            :title="isolatedAlreadyFiltered ? 'Already filtered by degree' : ''"
            @click="!isolatedAlreadyFiltered && (filters.hideIsolated = !filters.hideIsolated)"
          >
            <component :is="(filters.hideIsolated || isolatedAlreadyFiltered) ? EyeOff : Eye" :size="11" />
            Hide isolated
          </button>
        </div>
      </template>

      <!-- Edge side: Weight filtering (only when the graph is weighted) -->
      <template v-else>
        <div v-if="schema?.weighted && schema?.weight_range" class="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-semibold uppercase tracking-wide text-muted">Weight filtering</span>
            <div class="segmented-track flex items-center">
              <button
                v-for="opt in MODE_OPTIONS" :key="opt.k"
                class="segmented-pill inline-flex items-center justify-center px-1.5 py-0 text-[10px]"
                :class="weightMode === opt.k ? 'segmented-pill--active' : ''"
                @click="weightMode = opt.k"
              >{{ opt.label }}</button>
            </div>
          </div>
          <RangeFilter
            :model-value="filters.weight?.value ?? schema.weight_range"
            :full-range="schema.weight_range"
            :mode="weightMode"
            @update:model-value="(v) => filters.weight = { mode: 'absolute', value: v }"
          />
          <button
            v-if="hasSelfLoops"
            class="text-[10px] flex items-center gap-1 transition self-start"
            :class="filters.hideSelfLoops ? 'text-red-500' : 'text-secondary hover:text-primary'"
            @click="filters.hideSelfLoops = !filters.hideSelfLoops"
          >
            <RotateCw :size="11" />
            Hide self-loops
          </button>
        </div>
        <!-- Unweighted but with self-loops: keep just the toggle in its own card. -->
        <div v-else-if="hasSelfLoops" class="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted">Edge structure</span>
          <button
            class="text-[10px] flex items-center gap-1 transition self-start"
            :class="filters.hideSelfLoops ? 'text-red-500' : 'text-secondary hover:text-primary'"
            @click="filters.hideSelfLoops = !filters.hideSelfLoops"
          >
            <RotateCw :size="11" />
            Hide self-loops
          </button>
        </div>
      </template>

      <!-- Per-type accordion: types without filterable attrs are omitted.
           The "Only meaningful filters are shown" disclaimer lives once at
           the section level in AppSidebar (under each Nodes/Edges title). -->
      <div v-if="filterableTypes.length > 0" class="flex flex-col gap-1">
        <div
          v-for="t in filterableTypes" :key="t"
          class="rounded-md border border-slate-200 bg-white"
        >
          <!-- Accordion header -->
          <button
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-slate-50 transition"
            @click="toggleType(t)"
          >
            <span class="flex items-center gap-1.5 min-w-0">
              <ChevronRight
                :size="12"
                class="shrink-0 transition-transform text-muted"
                :class="openTypes.has(t) ? 'rotate-90' : ''"
              />
              <span class="text-xs font-semibold text-primary truncate">{{ t }}</span>
            </span>
            <span class="text-[10px] text-muted shrink-0">
              {{ attrsFor(scope, t).length }} attr{{ attrsFor(scope, t).length === 1 ? '' : 's' }}
              <template v-if="Object.keys(filters[storeKey][t] || {}).length > 0">
                · <span class="text-amber-600 font-medium">{{ Object.keys(filters[storeKey][t]).length }} active</span>
              </template>
            </span>
          </button>

          <!-- Accordion body -->
          <div v-if="openTypes.has(t)" class="border-t border-slate-100 px-2 py-2 flex flex-col">
            <div
              v-for="(entry, i) in attrsFor(scope, t)" :key="entry.attr"
              class="flex flex-col gap-1 py-2"
              :class="i > 0 ? 'border-t border-slate-100' : ''"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-baseline gap-1.5 min-w-0">
                  <span class="text-[11px] font-medium text-primary truncate">{{ entry.attr }}</span>
                  <span class="text-[9px] text-muted uppercase tracking-wide shrink-0">{{ entry.kind }}</span>
                  <span v-if="attrCoverage(t, entry.attr)" class="text-[10px] font-semibold tabular-nums text-sky-700 shrink-0">
                    {{ attrCoverage(t, entry.attr) }}
                  </span>
                </span>
                <!-- Range-only: Abs/% toggle next to the attr name. -->
                <div v-if="entry.kind === 'numeric' || entry.kind === 'temporal'" class="segmented-track flex items-center shrink-0">
                  <button
                    v-for="opt in MODE_OPTIONS" :key="opt.k"
                    class="segmented-pill inline-flex items-center justify-center px-1.5 py-0 text-[10px]"
                    :class="getAttrMode(t, entry.attr) === opt.k ? 'segmented-pill--active' : ''"
                    @click="setAttrMode(t, entry.attr, opt.k)"
                  >{{ opt.label }}</button>
                </div>
              </div>
              <p v-if="attrSummary(t, entry.attr)" class="text-[10px] leading-tight text-muted">
                {{ attrSummary(t, entry.attr) }}
              </p>

              <!-- Categorical -->
              <div v-if="entry.kind === 'categorical'" class="flex flex-wrap gap-1">
                <button
                  v-for="v in Object.keys(entry.values)" :key="v"
                  class="type-chip text-[10px] px-1.5 py-0"
                  :class="{ 'type-chip--active': isCategoricalActive(t, entry.attr, v) }"
                  @click="toggleCategorical(t, entry.attr, v)"
                >
                  {{ v }}
                  <span class="text-muted">· {{ entry.values[v].length }}</span>
                </button>
              </div>

              <!-- Numeric -->
              <div v-else-if="entry.kind === 'numeric'" class="px-1 py-1">
                <RangeFilter
                  :model-value="getRange(t, entry.attr) ?? entry.range"
                  :full-range="entry.range"
                  :sorted-pairs="entry.sorted"
                  :mode="getAttrMode(t, entry.attr)"
                  @update:model-value="(v) => setRange(t, entry.attr, 'numeric', v, entry.range)"
                />
              </div>

              <!-- Boolean -->
              <div v-else-if="entry.kind === 'boolean'" class="flex gap-1">
                <button
                  v-for="opt in ['any', 'true', 'false']" :key="opt"
                  class="type-chip text-[10px] px-1.5 py-0 flex-1 text-center"
                  :class="{ 'type-chip--active': getBooleanValue(t, entry.attr) === opt }"
                  @click="setBooleanValue(t, entry.attr, opt)"
                >
                  <span class="capitalize">{{ opt }}</span>
                  <template v-if="opt === 'true'"><span class="text-muted"> · {{ entry.true.length }}</span></template>
                  <template v-else-if="opt === 'false'"><span class="text-muted"> · {{ entry.false.length }}</span></template>
                </button>
              </div>

              <!-- Temporal -->
              <div v-else-if="entry.kind === 'temporal'" class="px-1 py-1">
                <RangeFilter
                  :model-value="getRange(t, entry.attr) ?? entry.range"
                  :full-range="entry.range"
                  :sorted-pairs="entry.sorted"
                  :step="1"
                  :mode="getAttrMode(t, entry.attr)"
                  @update:model-value="(v) => setRange(t, entry.attr, 'date', v, entry.range)"
                />
              </div>

              <!-- Text (high-cardinality identifier: substring/exact search) -->
              <div v-else-if="entry.kind === 'text'" class="flex flex-col gap-1">
                <div class="flex items-center gap-1.5 input-base px-2 py-1 text-[11px]">
                  <Search :size="12" class="text-muted shrink-0" />
                  <input
                    type="text"
                    :value="getTextQuery(t, entry.attr)"
                    :placeholder="entry.sample?.length ? `e.g. ${entry.sample[0]}` : 'Search…'"
                    class="flex-1 bg-transparent outline-none"
                    @input="setTextQuery(t, entry.attr, $event.target.value)"
                  />
                  <button
                    v-if="getTextQuery(t, entry.attr)"
                    class="text-muted hover:text-red-500 shrink-0"
                    title="Clear"
                    @click="clearSpec(t, entry.attr)"
                  ><X :size="11" /></button>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <div class="segmented-track flex items-center">
                    <button
                      v-for="opt in TEXT_MODE_OPTIONS" :key="opt.k"
                      class="segmented-pill inline-flex items-center justify-center px-1.5 py-0 text-[9px]"
                      :class="getTextMode(t, entry.attr) === opt.k ? 'segmented-pill--active' : ''"
                      :disabled="!getTextQuery(t, entry.attr)"
                      @click="setTextMode(t, entry.attr, opt.k)"
                    >{{ opt.label }}</button>
                  </div>
                  <span class="text-[9px] text-muted tabular-nums">{{ entry.distinct }} distinct</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
