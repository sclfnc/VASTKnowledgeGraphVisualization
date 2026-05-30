// Per-panel composable: gives panels a single way to ask "what is this
// item's effective type?". Routes through /effective-types/ when the
// schema declares an auto_promoted attr (or the user picks one manually).
//
// Three lookups exposed:
//   nodeType(item)        → string  (item is {id, type, ...} OR a node index)
//   edgeType(item)        → string  (item is {edge_id, type, ...} OR an edge index)
//   nodeTypeList          → string[]  (the active set of effective node types)
//   edgeTypeList          → string[]  (the active set of effective edge types)
//   promoted              → {node, edge}  (echo of the resolved promotion, for captions)
//
// Falls back to item.type when no promotion is active.
import { computed, toValue } from 'vue'
import { injectEffectiveTypes } from './useEffectiveTypes.js'
import { injectGraphNodes } from './useGraphNodes.js'

export function useEffectiveType(graphId, schemaRef) {
  const { data: effData } = injectEffectiveTypes(graphId)
  const { nodes } = injectGraphNodes(graphId)

  const nodeLabels = computed(() => effData.value?.node ?? null)
  const edgeLabels = computed(() => effData.value?.edge ?? null)
  const promoted = computed(() => effData.value?.promoted ?? { node: null, edge: null })

  function _nodeIdx(item) {
    if (typeof item === 'number') return item
    if (item && typeof item === 'object') {
      if ('id' in item && nodes.value) {
        const idx = nodes.value.idToIdx.get(String(item.id))
        if (idx != null) return idx
      }
    }
    return -1
  }

  function nodeType(item) {
    const labels = nodeLabels.value
    if (labels) {
      const idx = _nodeIdx(item)
      if (idx >= 0 && idx < labels.length) return labels[idx]
    }
    if (item && typeof item === 'object' && 'type' in item) return item.type
    return null
  }

  // Fast lookup by SoA index (no id resolution). Returns the effective label
  // if promotion is active, else falls back to the raw type from SoA.
  function nodeTypeAt(idx) {
    const labels = nodeLabels.value
    if (labels && idx >= 0 && idx < labels.length) return labels[idx]
    return nodes.value?.types?.[idx] ?? null
  }

  function edgeTypeAt(idx) {
    const labels = edgeLabels.value
    if (labels && idx >= 0 && idx < labels.length) return labels[idx]
    return null
  }

  function edgeType(item) {
    const labels = edgeLabels.value
    let idx = -1
    if (typeof item === 'number') idx = item
    else if (item && typeof item === 'object' && 'edge_id' in item) idx = item.edge_id
    if (labels && idx >= 0 && idx < labels.length) return labels[idx]
    if (item && typeof item === 'object' && 'type' in item) return item.type
    return null
  }

  const nodeTypeList = computed(() => {
    const labels = nodeLabels.value
    if (labels) {
      // Preserve first-seen order (which mirrors degree-desc, fine for legends).
      const seen = new Set()
      const out = []
      for (const l of labels) {
        if (!seen.has(l)) { seen.add(l); out.push(l) }
      }
      return out.sort()
    }
    return toValue(schemaRef)?.node_types ?? []
  })

  const edgeTypeList = computed(() => {
    const labels = edgeLabels.value
    if (labels) {
      const seen = new Set()
      const out = []
      for (const l of labels) {
        if (!seen.has(l)) { seen.add(l); out.push(l) }
      }
      return out.sort()
    }
    return toValue(schemaRef)?.edge_types ?? []
  })

  // Build {effectiveType: T[]} from a per-node-index value array.
  // Use this in panels that have access to per-node data via SoA.
  function groupByEffectiveType(perIdxValues) {
    const labels = nodeLabels.value
    if (!labels) {
      // Fallback: group by raw type from SoA.
      const soa = nodes.value
      if (!soa) return {}
      const out = {}
      const len = Math.min(soa.N, perIdxValues?.length ?? 0)
      for (let i = 0; i < len; i++) {
        const t = soa.types[i]
        ;(out[t] ??= []).push(perIdxValues[i])
      }
      return out
    }
    const out = {}
    const len = Math.min(labels.length, perIdxValues?.length ?? 0)
    for (let i = 0; i < len; i++) {
      const t = labels[i]
      ;(out[t] ??= []).push(perIdxValues[i])
    }
    return out
  }

  return {
    nodeType, edgeType, nodeTypeAt, edgeTypeAt,
    nodeTypeList, edgeTypeList, promoted,
    groupByEffectiveType,
  }
}
