// Reactive fetch of /edges/{id} with a derived SoA view.
// `edges` holds typed arrays + per-type Bitset; `edge_id` is the array index.
// Used by useFilteredModel for the edge mask AND-chain.
import { computed, watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { Bitset } from '@/utils/bitset.js'

function buildSoA(raw) {
  const sourceArr = raw.source ?? []
  const E = sourceArr.length
  const source = new Int32Array(E)
  const target = new Int32Array(E)
  const type = new Int8Array(E)
  for (let i = 0; i < E; i++) {
    source[i] = sourceArr[i] | 0
    target[i] = raw.target[i] | 0
    type[i] = raw.type[i] | 0
  }
  const weight = raw.weight ? Float32Array.from(raw.weight) : null
  const edgeTypes = raw.edge_types ?? []

  const typeMasks = new Map()
  for (let i = 0; i < edgeTypes.length; i++) {
    typeMasks.set(edgeTypes[i], new Bitset(E))
  }
  for (let i = 0; i < E; i++) {
    typeMasks.get(edgeTypes[type[i]]).set(i)
  }

  return { E, source, target, type, weight, edgeTypes, typeMasks }
}

export function useGraphEdges(graphId) {
  const { data, loading, error, run } = useFetch()

  async function load(id) {
    if (!id) { data.value = null; return }
    await run(apiUrl(`/edges/${id}`))
  }

  watch(() => toValue(graphId), load, { immediate: true })

  const edges = computed(() => {
    const raw = data.value
    if (!raw || !Array.isArray(raw.source)) return null
    return buildSoA(raw)
  })

  return { data, loading, error, edges }
}
