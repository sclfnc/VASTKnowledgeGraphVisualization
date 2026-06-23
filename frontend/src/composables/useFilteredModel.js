// Global filter masks for nodes and edges. Filtering flows in one direction
// only: the node mask never depends on edge filters. The edge mask is AND-ed
// with the node mask at the final step, so an edge counts as "active" only when
// it passes all edge filters AND both of its endpoints pass the node filters.
//
// Pin/Isolation are applied later in usePanelContext.
import { computed } from 'vue'
import { useFiltersStore } from '@/stores/filters.js'
import { injectGraphNodes } from './useGraphNodes.js'
import { injectGraphEdges } from './useGraphEdges.js'
import { injectAttributeIndex } from './useAttributeIndex.js'
import { injectEffectiveTypes } from './useEffectiveTypes.js'
import { useEdgeFlow } from './useEdgeFlow.js'
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

    // Component filter — { scope: 'wcc'|'scc', ids } | old-style array (read as
    // WCC). The scope picks which membership array to match against, so SCC rank
    // filtering applies the ids to soa.sccId rather than soa.wccId.
    const cf = filters.wccFilter
    if (cf) {
      const cfIds = Array.isArray(cf) ? cf : cf.ids
      const cfScope = Array.isArray(cf) ? 'wcc' : cf.scope
      const memberOf = cfScope === 'scc' ? soa.sccId : soa.wccId
      if (Array.isArray(cfIds) && cfIds.length > 0 && memberOf) {
        const allowed = new Set(cfIds)
        for (let i = 0; i < N; i++) {
          if (!allowed.has(memberOf[i])) mask.clear(i)
        }
      }
    }

    // v2: per-type attribute filters. A node passes if EITHER its type has
    // no constraints (it was left untouched), OR its type has constraints and
    // the node matches ALL of them (AND across the attrs of the same type).
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

    // v2: temporal filter (a single brushed window from ActivityTimeline).
    // Shape: { attr, scope, range:[lo,hi] }. Applied only when scope === 'node'.
    // This skips the per-type logic: a temporal brush applies to the attr
    // across all types that carry it. We OR the matching bitsets over every
    // (type, attr) entry in the index — a node passes if any bucket contains it.
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

    // Step 5: AND with node mask — an edge is active only if both endpoints survive
    const nodeMask = activeNodeMask.value
    if (nodeMask) {
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue
        if (!nodeMask.get(source[i]) || !nodeMask.get(target[i])) mask.clear(i)
      }
    }

    // Step 6: filter by source/target type
    const sf = filters.sourceType;
    const tf = filters.targetType;
    const effNodeLabels = effData.value?.node ?? nodes.value.types;
    const directed = useEdgeFlow.value?.directed ?? false;

    if (!directed) {
      for (let i = 0; i < E; i++) {
        if (sf && tf) {
          // Nested check
          if (sf === effNodeLabels[source[i]]) {
            if (tf !== effNodeLabels[target[i]]) {
              mask.clear(i);
            } else continue;
          } else if (sf === effNodeLabels[target[i]]) {
            if (tf !== effNodeLabels[source[i]]) {
              mask.clear(i);
            } else continue;
          } else mask.clear(i);
        } else if (sf) {
          // Check if one of them matches
          if (sf !== effNodeLabels[source[i]] && sf !== effNodeLabels[target[i]]) mask.clear(i);
        } else if (tf) {
          // Check if one of them matches
          if (tf !== effNodeLabels[source[i]] && tf !== effNodeLabels[target[i]]) mask.clear(i);
        } else continue;
      }
    } else {
      for (let i = 0; i < E; i++) {
        if (!mask.get(i)) continue;
        if ((sf && effNodeLabels[source[i]] !== sf) || (tf && effNodeLabels[target[i]] !== tf))
          mask.clear(i);
      }
    }

    return mask;
  });

  return { activeNodeMask, activeEdgeMask };
}
