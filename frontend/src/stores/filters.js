// EXTENSION: filters store — UI state only, not yet applied to graph rendering.
// Numeric filters carry { mode: 'absolute' | 'percentile' | 'outliers', value }.
// Categorical filters (node/edge type, attribute multi-select) carry an array of selected values.
import { defineStore } from 'pinia'
import { ref } from 'vue'

const numeric = (range) => ({ mode: 'absolute', value: range ? [...range] : [0, 0] })

export const useFiltersStore = defineStore('filters', () => {
  const nodeTypes = ref([])
  const edgeTypes = ref([])
  const degree = ref(numeric([0, 0]))
  const weight = ref(numeric([0, 0]))
  const attributes = ref({})  // { attrName: { mode, value } | string[] }
  const hops = ref(0)         // N-hop expansion around cross-panel selection; -1 means "all reachable"
  const hideIsolated = ref(false)
  const hideSelfLoops = ref(false)
  // Open landing point: written by Activity Timeline brush, read by future
  // panels that want to respect a temporal window. No current consumer.
  // Shape: null (no filter) | { attr: string, range: [int, int] (inclusive) }
  const temporalFilter = ref(null)
  // null = all components; array of component ids (0-based, size-desc order) = filter active
  const wccFilter = ref(null)

  function reset(schema) {
    nodeTypes.value = [...(schema?.node_types ?? [])]
    edgeTypes.value = [...(schema?.edge_types ?? [])]
    degree.value = numeric(schema?.degree_range)
    weight.value = numeric(schema?.weight_range)
    attributes.value = Object.fromEntries(
      (schema?.attributes ?? []).map(a => [
        a.name,
        a.kind === 'numeric' ? numeric(a.range) : []
      ])
    )
    hops.value = 0
    hideIsolated.value = false
    hideSelfLoops.value = false
    temporalFilter.value = null
    wccFilter.value = null
  }

  return { nodeTypes, edgeTypes, degree, weight, attributes, hops, hideIsolated, hideSelfLoops, temporalFilter, wccFilter, reset }
})
