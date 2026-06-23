<script setup>
// Thin sticky strip above the panel grid. Action-only: active filter chips
// (each with `×` to remove inline) + undo/redo/reset. Dataset metadata and
// counts live in AppSidebar → GraphStatus; this strip is purely about
// "what's on right now and how do I act on it".
//
// The chips matter because filter controls are scattered across the
// sidebar's Filters mode — without a global view of "what's on" the user
// could lose track of state when in Contents mode.
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-vue-next'
import { injectSchema } from '../composables/useSchema.js'
import { useFiltersStore } from '../stores/filters.js'
import { useFilterHistoryStore } from '../stores/filterHistory.js'
import { useSelectionStore } from '../stores/selection.js'
import { useGraphStore } from '../stores/graph.js'
import { useEffectiveType } from '../composables/useEffectiveType.js'

const { schema } = injectSchema()
const { graphId } = storeToRefs(useGraphStore())
const filters = useFiltersStore()
const filterHistory = useFilterHistoryStore()
const selection = useSelectionStore()
const { nodeTypeList, edgeTypeList } = useEffectiveType(graphId, schema)

const effectiveNodeTypes = computed(() =>
  nodeTypeList.value.length ? nodeTypeList.value : (schema.value?.node_types ?? []))
const effectiveEdgeTypes = computed(() =>
  edgeTypeList.value.length ? edgeTypeList.value : (schema.value?.edge_types ?? []))

// Active filter summary — one chip per active constraint, removable inline.
const activeChips = computed(() => {
  const chips = []
  if (filters.nodeTypes.length < effectiveNodeTypes.value.length) {
    chips.push({
      key: 'nodeTypes',
      label: `Node Type: ${filters.nodeTypes.length}/${effectiveNodeTypes.value.length}`,
      remove: () => { filters.nodeTypes = [...effectiveNodeTypes.value] },
    })
  }
  if (filters.edgeTypes.length < effectiveEdgeTypes.value.length) {
    chips.push({
      key: 'edgeTypes',
      label: `Edge Type: ${filters.edgeTypes.length}/${effectiveEdgeTypes.value.length}`,
      remove: () => { filters.edgeTypes = [...effectiveEdgeTypes.value] },
    })
  }

  if (filters.sourceType) {
    chips.push({
      key: 'sourceType',
      label: schema.value?.directed
        ? `Source Node Type: ${filters.sourceType}`
        : `Incident Node Type: ${filters.sourceType}`,
      remove: () => { filters.sourceType = null }
    })
  }

  if (filters.targetType) {
    chips.push({
      key: 'targetType',
      label: schema.value?.directed
        ? `Target Node Type: ${filters.targetType}`
        : `Incident Node Type: ${filters.targetType}`,
      remove: () => { filters.targetType = null }
    })
  }
  const dRange = filters.degree?.value
  const dFull = schema.value?.degree_range
  if (dRange && dFull && (dRange[0] > dFull[0] || dRange[1] < dFull[1])) {
    chips.push({
      key: 'degree',
      label: `Degree ∈ [${dRange[0]}, ${dRange[1]}]`,
      remove: () => { filters.degree = { mode: 'absolute', value: [...dFull] } },
    })
  }
  const wRange = filters.weight?.value
  const wFull = schema.value?.weight_range
  if (wRange && wFull && (wRange[0] > wFull[0] || wRange[1] < wFull[1])) {
    chips.push({
      key: 'weight',
      label: `Weight ∈ [${wRange[0]}, ${wRange[1]}]`,
      remove: () => { filters.weight = { mode: 'absolute', value: [...wFull] } },
    })
  }
  if (filters.hideIsolated) {
    chips.push({ key: 'hideIsolated', label: 'Hide isolated', remove: () => { filters.hideIsolated = false } })
  }
  if (filters.hideSelfLoops) {
    chips.push({ key: 'hideSelfLoops', label: 'Hide self-loops', remove: () => { filters.hideSelfLoops = false } })
  }
  if (filters.wccFilter) {
    // Scoped slot { scope, ids } | legacy array (read as WCC).
    const cf = filters.wccFilter
    const cfIds = Array.isArray(cf) ? cf : (cf.ids ?? [])
    const cfScope = (Array.isArray(cf) ? 'wcc' : cf.scope).toUpperCase()
    if (cfIds.length > 0) {
      chips.push({
        key: 'wcc',
        label: cfIds.length === 1 ? `${cfScope} #${cfIds[0] + 1}` : `${cfScope}: ${cfIds.length}`,
        remove: () => { filters.wccFilter = null },
      })
    }
  }
  if (filters.temporalFilter) {
    const tf = filters.temporalFilter
    chips.push({
      key: 'temporal',
      label: `${tf.attr} ∈ [${tf.range[0]}, ${tf.range[1]}]`,
      remove: () => { filters.temporalFilter = null },
    })
  }
  for (const [t, constraints] of Object.entries(filters.nodeAttrs || {})) {
    for (const [attr, spec] of Object.entries(constraints)) {
      chips.push({
        key: `node:${t}:${attr}`,
        label: `${t}.${attr} ${formatSpec(spec)}`,
        remove: () => { filters.setNodeAttr(t, attr, null) },
      })
    }
  }
  for (const [t, constraints] of Object.entries(filters.edgeAttrs || {})) {
    for (const [attr, spec] of Object.entries(constraints)) {
      chips.push({
        key: `edge:${t}:${attr}`,
        label: `${t}.${attr} ${formatSpec(spec)}`,
        remove: () => { filters.setEdgeAttr(t, attr, null) },
      })
    }
  }
  return chips
})

function formatSpec(spec) {
  if (!spec) return ''
  if (spec.kind === 'categorical') {
    const vals = Array.isArray(spec.values) ? spec.values : []
    if (vals.length === 0) return ''
    if (vals.length === 1) return `= ${vals[0]}`
    if (vals.length <= 3) return `∈ {${vals.join(', ')}}`
    return `∈ {${vals.slice(0, 2).join(', ')}, +${vals.length - 2}}`
  }
  if (spec.kind === 'numeric' || spec.kind === 'date') {
    const r = Array.isArray(spec.range) ? spec.range : []
    if (r.length < 2) return ''
    return `∈ [${r[0]}, ${r[1]}]`
  }
  if (spec.kind === 'boolean') return `= ${spec.value}`
  return ''
}

function resetAll() {
  filters.reset(schema.value)
  selection.clearAll()
  filterHistory.clearAll()
  filterHistory.baseline()
}
</script>

<template>
  <div v-if="schema" class="flex flex-col gap-1.5">
    <!-- Toolbar: undo / redo / reset on the left, chip count on the right. -->
    <div class="flex items-center gap-0.5">
      <button
        class="rounded p-0.5 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!filterHistory.canBack"
        title="Undo last filter change"
        @click="filterHistory.back(schema)">
        <ChevronLeft :size="14" />
      </button>
      <button
        class="rounded p-0.5 text-secondary transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!filterHistory.canForward"
        title="Redo"
        @click="filterHistory.forward(schema)">
        <ChevronRight :size="14" />
      </button>
      <button
        class="rounded p-0.5 text-secondary transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!activeChips.length"
        title="Reset all filters"
        @click="resetAll">
        <RotateCcw :size="12" />
      </button>
      <span class="ml-auto text-[10px] uppercase tracking-wider text-secondary">
        {{ activeChips.length }} active
      </span>
    </div>

    <!-- Active filter chips (or "no filters active" placeholder) -->
    <div v-if="activeChips.length" class="flex flex-wrap items-center gap-1">
      <span v-for="c in activeChips" :key="c.key"
        class="inline-flex h-[18px] items-center rounded-full border border-slate-300 bg-white pl-2 pr-1.5 text-[10px] leading-none text-slate-700 shadow-sm">
        {{ c.label }}
        <button
          class="ml-1.5 -mr-1.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 transition hover:text-red-500 hover:bg-red-50"
          @click="c.remove()">
          <X :size="10" :stroke-width="2.25" />
        </button>
      </span>
    </div>
    <span v-else class="text-[10px] italic text-muted">No filters active</span>
  </div>
</template>
