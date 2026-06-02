// Reactive fetch of /nodes/{id} with a derived SoA view.
// `data` is the raw AoS payload (array of objects, for older consumers);
// `nodes` is the SoA (typed arrays + per-type Bitset + idToIdx) used by the
// layer that propagates filters.
//
// Singleton pattern: GuideView calls `useGraphNodes(graphId)` once and
// `provide('graphNodes', …)`. Consumers should call `injectGraphNodes()`
// to share the single fetch + parsed SoA. Direct calls to `useGraphNodes`
// outside GuideView (e.g. DatasetView, unit tests) still work and create
// an isolated instance.
import { computed, inject, watch, toValue } from 'vue'
import { apiUrl } from './useApi.js'
import { useFetch } from './useFetch.js'
import { Bitset } from '@/utils/bitset.js'

const INJECT_KEY = 'graphNodes'

function buildSoA(rows) {
  const N = rows.length
  const ids = Array.from({ length: N })
  const types = Array.from({ length: N })
  const degrees = new Int32Array(N)
  const wccId = new Int32Array(N)
  const hasScc = rows.length > 0 && 'scc_id' in rows[0]
  const sccId = hasScc ? new Int32Array(N) : null
  const idToIdx = new Map()
  const typeMasks = new Map()

  for (let i = 0; i < N; i++) {
    const r = rows[i]
    const id = String(r.id)
    ids[i] = id
    types[i] = r.type
    degrees[i] = r.degree | 0
    wccId[i] = r.wcc_id | 0
    if (hasScc) sccId[i] = r.scc_id | 0
    idToIdx.set(id, i)
    let mask = typeMasks.get(r.type)
    if (!mask) {
      mask = new Bitset(N)
      typeMasks.set(r.type, mask)
    }
    mask.set(i)
  }

  return { N, ids, types, degrees, wccId, sccId, idToIdx, typeMasks }
}

export function useGraphNodes(graphId) {
  const { data, loading, error, run } = useFetch()

  async function load(id) {
    if (!id) { data.value = null; return }
    await run(apiUrl(`/nodes/${id}`))
  }

  watch(() => toValue(graphId), load, { immediate: true })

  const nodes = computed(() => {
    const rows = data.value
    if (!Array.isArray(rows) || rows.length === 0) return null
    return buildSoA(rows)
  })

  return { data, loading, error, nodes }
}

// Consumer-side accessor. Reads the singleton provided by GuideView; falls
// back to a fresh instance (with graphId from the graph store) when the
// provide is missing — keeps DatasetView and tests working.
export function injectGraphNodes(graphIdFallback) {
  const provided = inject(INJECT_KEY, null)
  if (provided) return provided
  return useGraphNodes(graphIdFallback)
}

export { INJECT_KEY as GRAPH_NODES_KEY }
