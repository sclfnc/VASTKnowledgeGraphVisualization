// EXTENSION: filters store — UI state only, not yet applied to graph rendering.
// Numeric filters carry { mode: 'absolute' | 'percentile' | 'outliers', value }.
// Categorical filters (node/edge type, attribute multi-select) carry an array of selected values.
//
// Per-type attribute filters live in `nodeAttrs` / `edgeAttrs`,
// keyed by `{[type]: {[attrName]: AttrFilterSpec}}`. Type absent = unaffected.
// AttrFilterSpec shapes:
//   categorical → {kind:'categorical', values: string[]}     (Sets serialize poorly; use arrays in store)
//   numeric     → {kind:'numeric',     range: [lo, hi]}
//   boolean     → {kind:'boolean',     value: true | false}
//   date        → {kind:'date',        range: [yearLo, yearHi]}
//   text        → {kind:'text',        query: string, mode: 'contains' | 'equals'}  (high-cardinality identifiers)
import { defineStore } from 'pinia'
import { ref } from 'vue'

const numeric = (range) => ({ mode: 'absolute', value: range ? [...range] : [0, 0] })

export const useFiltersStore = defineStore('filters', () => {
  const nodeTypes = ref([])
  const edgeTypes = ref([])
  const degree = ref(numeric([0, 0]))
  const weight = ref(numeric([0, 0]))
  const hideIsolated = ref(false)
  const hideSelfLoops = ref(false)
  // Open slot for later use: written by the Activity Timeline brush, read by
  // future panels that want to respect a temporal window. No consumer yet.
  // Shape: null (no filter) | { attr: string, range: [int, int] (inclusive) }
  const temporalFilter = ref(null)
  // Component filter — { scope: 'wcc'|'scc', ids: number[] } | null
  // (a plain array is read as an old-style WCC list). Component ids are 0-based
  // and sorted by size, matching /components/ and /nodes/.{wcc_id,scc_id}. The
  // scope says which membership array useFilteredModel should match against,
  // since WCC and SCC ids do not share the same numbering. ConnectedComponents
  // writes it tagged by its active mode. null = all components.
  const wccFilter = ref(null)
  const sourceType = ref(null)
  const targetType = ref(null)

  // v2 per-type attribute filters.
  const nodeAttrs = ref({})  // {[nodeType]: {[attr]: AttrFilterSpec}}
  const edgeAttrs = ref({})  // {[edgeType]: {[attr]: AttrFilterSpec}}

  // `effective` is the optional `/effective-types/` payload. When auto-promotion
  // is active (Karate's `club`, Davis' `bipartite`), nodeTypes/edgeTypes are
  // seeded with the unique effective labels so the chip group + AND-chain agree.
  function reset(schema, effective = null) {
    const effNodeLabels = effective?.node
    const effEdgeLabels = effective?.edge
    nodeTypes.value = effNodeLabels
      ? [...new Set(effNodeLabels)].sort()
      : [...(schema?.node_types ?? [])]
    edgeTypes.value = effEdgeLabels
      ? [...new Set(effEdgeLabels)].sort()
      : [...(schema?.edge_types ?? [])]
    degree.value = numeric(schema?.degree_range)
    weight.value = numeric(schema?.weight_range)
    hideIsolated.value = false
    hideSelfLoops.value = false
    temporalFilter.value = null
    wccFilter.value = null
    sourceType.value = null
    targetType.value  = null
    nodeAttrs.value = {}
    edgeAttrs.value = {}
  }

  // Mutators with auto-cleanup of empty inner objects (canonical form: no
  // empty `nodeAttrs[type]` — once last attr is cleared, the type is removed).
  function setNodeAttr(type, attr, spec) {
    const next = { ...nodeAttrs.value }
    const inner = { ...next[type] }
    if (spec === null || spec === undefined) {
      delete inner[attr]
    } else {
      inner[attr] = spec
    }
    if (Object.keys(inner).length === 0) delete next[type]
    else next[type] = inner
    nodeAttrs.value = next
  }

  function setEdgeAttr(type, attr, spec) {
    const next = { ...edgeAttrs.value }
    const inner = { ...next[type] }
    if (spec === null || spec === undefined) {
      delete inner[attr]
    } else {
      inner[attr] = spec
    }
    if (Object.keys(inner).length === 0) delete next[type]
    else next[type] = inner
    edgeAttrs.value = next
  }

  function clearNodeAttrs(type) {
    if (type == null) { nodeAttrs.value = {}; return }
    const next = { ...nodeAttrs.value }
    delete next[type]
    nodeAttrs.value = next
  }

  function clearEdgeAttrs(type) {
    if (type == null) { edgeAttrs.value = {}; return }
    const next = { ...edgeAttrs.value }
    delete next[type]
    edgeAttrs.value = next
  }

  return {
    nodeTypes, edgeTypes, degree, weight,
    hideIsolated, hideSelfLoops, temporalFilter, wccFilter,
    sourceType, targetType,
    nodeAttrs, edgeAttrs,
    reset, setNodeAttr, setEdgeAttr, clearNodeAttrs, clearEdgeAttrs,
  }
})
