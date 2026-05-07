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
  const selected = ref([])    // node ids selected for focus/neighborhood
  const hops = ref(0)         // N-hop expansion around `selected`; -1 means "all reachable"
  const hideIsolated = ref(false)

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
    selected.value = []
    hops.value = 0
    hideIsolated.value = false
  }

  return { nodeTypes, edgeTypes, degree, weight, attributes, selected, hops, hideIsolated, reset }
})
