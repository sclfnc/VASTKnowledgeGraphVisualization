// Global filter masks for nodes and edges. The chain is unidirectional —
// node mask is independent of edge filters; edge mask AND-s with node mask
// at the final step so an edge is "active" iff it passes all edge filters
// AND both its endpoints survive the node filters.
//
// Pin/Isolation are applied later in usePanelContext.
import { computed } from 'vue'
import { useFiltersStore } from '@/stores/filters.js'
import { injectGraphNodes } from './useGraphNodes.js'
import { injectGraphEdges } from './useGraphEdges.js'
import { injectAttributeIndex } from './useAttributeIndex.js'
import { injectEffectiveTypes } from './useEffectiveTypes.js'
import { Bitset } from '@/utils/bitset.js'
import { lowerBound, upperBound } from '@/utils/binsearch.js'

export function useFilteredModel(graphId) {
  const filters = useFiltersStore()
  const { nodes } = injectGraphNodes(graphId)
  const { edges } = injectGraphEdges(graphId)
  const attrIndex = injectAttributeIndex(graphId)
  const { data: effData } = injectEffectiveTypes(graphId)

  const activeNodeMask = computed(() => {
    const soa = nodes.value
    if (!soa) return null
    const { N, degrees, typeMasks } = soa

    const mask = new Bitset(N)
    const selectedTypes = filters.nodeTypes
    const effNodeLabels = effData.value?.node
    if (selectedTypes && selectedTypes.length > 0) {
      if (effNodeLabels) {
        // Effective labels: iterate once, set bit if node's effective type is selected.
        const wanted = new Set(selectedTypes)
        for (let i = 0; i < N; i++) {
          if (wanted.has(effNodeLabels[i])) mask.set(i)
        }
      } else {
        // No promotion: raw typeMasks suffice (OR over selected types).
        for (const t of selectedTypes) {
          const m = typeMasks.get(t)
          if (m) mask.orInPlace(m)
        }
      }
    }

    const range = filters.degree?.value
    if (Array.isArray(range) && range.length === 2) {
      const [dMin, dMax] = range
      const hi = lowerBound(degrees, dMax, true)
      const lo = upperBound(degrees, dMin, true)
      for (let i = 0; i < hi; i++) mask.clear(i)
      for (let i = lo; i < N; i++) mask.clear(i)
    }

    if (filters.hideIsolated) {
      const firstZero = lowerBound(degrees, 0, true)
      for (let i = firstZero; i < N; i++) {
        if (degrees[i] === 0) mask.clear(i)
      }
    }

    if (filters.wccFilter && filters.wccFilter.length > 0) {
      const wccIds = soa.wccId
      if (wccIds) {
        const allowed = new Set(filters.wccFilter)
        for (let i = 0; i < N; i++) {
          if (!allowed.has(wccIds[i])) mask.clear(i)
        }
      }
    }

    // v2: per-type attribute filters. A node passes iff EITHER its type has
    // no constraints (untouched), OR its type has constraints and the node
    // matches ALL of them (AND across attrs of the same type).
    const nodeAttrs = filters.nodeAttrs
    if (nodeAttrs && Object.keys(nodeAttrs).length > 0 && attrIndex.ready.value) {
      const passMask = new Bitset(N)
      // Types not in nodeAttrs: all their nodes pass.
      for (const [t, tMask] of typeMasks) {
        if (!(t in nodeAttrs)) passMask.orInPlace(tMask)
      }
      // Types in nodeAttrs: build per-attr bitset, AND together, AND with type mask, OR into passMask.
      for (const [t, constraints] of Object.entries(nodeAttrs)) {
        const tMask = typeMasks.get(t)
        if (!tMask) continue   // unknown type → no nodes
        const allowed = tMask.clone()
        for (const [attr, spec] of Object.entries(constraints)) {
          const bs = attrIndex.bitsetFor('node', t, attr, spec)
          if (bs) allowed.andInPlace(bs)
          else { allowed.clearAll(); break }
        }
        passMask.orInPlace(allowed)
      }
      mask.andInPlace(passMask)
    }

    // v2: temporal filter (single brushed window from ActivityTimeline).
    // Shape: { attr, scope, range:[lo,hi] }. Applied iff scope === 'node'.
    // Bypasses the per-type machinery: a temporal brush is global on the attr
    // regardless of which types carry it. We OR the matching bitsets across
    // every (type, attr) entry in the index — node passes iff any bucket
    // contains it.
    const tf = filters.temporalFilter
    if (tf && tf.scope === 'node' && Array.isArray(tf.range) && attrIndex.ready.value) {
      const tfMask = new Bitset(N)
      const payload = attrIndex.data.value?.node_attrs ?? {}
      const spec = { kind: 'date', range: tf.range }
      for (const type of Object.keys(payload)) {
        if (!payload[type]?.[tf.attr]) continue
        const bs = attrIndex.bitsetFor('node', type, tf.attr, spec)
        if (bs) tfMask.orInPlace(bs)
      }
      mask.andInPlace(tfMask)
    }

    return mask
  })

  const activeEdgeMask = computed(() => {
    const soa = edges.value
    if (!soa) return null
    const { E, source, target, weight, edgeTypes, typeMasks } = soa

    const mask = new Bitset(E)
    mask.setAll()

    // Step 1: edge type filter (OR of typeMasks for selected types — or
    // effective-label match when edge auto-promotion is active).
    const selectedEdgeTypes = filters.edgeTypes
    const effEdgeLabels = effData.value?.edge
    const totalEdgeTypes = effEdgeLabels
      ? new Set(effEdgeLabels).size
      : edgeTypes.length
    if (selectedEdgeTypes && selectedEdgeTypes.length < totalEdgeTypes) {
      const typeMask = new Bitset(E)
      if (effEdgeLabels) {
        const wanted = new Set(selectedEdgeTypes)
        for (let i = 0; i < E; i++) {
          if (wanted.has(effEdgeLabels[i])) typeMask.set(i)
        }
      } else {
        for (const t of selectedEdgeTypes) {
          const m = typeMasks.get(t)
          if (m) typeMask.orInPlace(m)
        }
      }
      mask.andInPlace(typeMask)
    }

    // Step 2: weight range filter (only on weighted graphs)
    // NaN comparisons return false in JS, so edges without weight survive the range filter.
    const weightRange = filters.weight?.value
    if (weight && Array.isArray(weightRange) && weightRange.length === 2) {
      const [wMin, wMax] = weightRange
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        const w = weight[i]
        if (w < wMin || w > wMax) mask.clear(i)
      }
    }

    // Step 3: self-loop filter
    if (filters.hideSelfLoops) {
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        if (source[i] === target[i]) mask.clear(i)
      }
    }

    // Step 4: v2 per-type edge attribute filters. Same shape as the node side.
    const edgeAttrs = filters.edgeAttrs
    if (edgeAttrs && Object.keys(edgeAttrs).length > 0 && attrIndex.ready.value) {
      const passMask = new Bitset(E)
      for (const [t, tMask] of typeMasks) {
        if (!(t in edgeAttrs)) passMask.orInPlace(tMask)
      }
      for (const [t, constraints] of Object.entries(edgeAttrs)) {
        const tMask = typeMasks.get(t)
        if (!tMask) continue
        const allowed = tMask.clone()
        for (const [attr, spec] of Object.entries(constraints)) {
          const bs = attrIndex.bitsetFor('edge', t, attr, spec)
          if (bs) allowed.andInPlace(bs)
          else { allowed.clearAll(); break }
        }
        passMask.orInPlace(allowed)
      }
      mask.andInPlace(passMask)
    }

    // v2: temporal filter, edge scope. Same OR-across-types pattern as nodes.
    const tfEdge = filters.temporalFilter
    if (tfEdge && tfEdge.scope === 'edge' && Array.isArray(tfEdge.range) && attrIndex.ready.value) {
      const tfMask = new Bitset(E)
      const payload = attrIndex.data.value?.edge_attrs ?? {}
      const spec = { kind: 'date', range: tfEdge.range }
      for (const type of Object.keys(payload)) {
        if (!payload[type]?.[tfEdge.attr]) continue
        const bs = attrIndex.bitsetFor('edge', type, tfEdge.attr, spec)
        if (bs) tfMask.orInPlace(bs)
      }
      mask.andInPlace(tfMask)
    }

    // Step 5: AND with node mask — edge active iff both endpoints survive
    const nodeMask = activeNodeMask.value
    if (nodeMask) {
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        if (!nodeMask.get(source[i]) || !nodeMask.get(target[i])) mask.clear(i)
      }
    }

    return mask
  })

  return { activeNodeMask, activeEdgeMask }
}
