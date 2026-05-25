// Unified data model for ego subgraphs (single + multi-ego).
//
// Backbone shape:
//   nodes: [{ id, type, degree, layers: Set<int>, isEgoOf: Set<int>, distance: Map<int, int> }]
//   edges: [{ source, target, type, layers: Set<int> }]
//
// - `layers` is the set of layer indices a node/edge appears in. For a
//   single-ego graph (one payload, layerIdx=0) it's always `{ 0 }`.
// - `isEgoOf` is the subset of layers for which this node IS the ego
//   (distance 0). Renderers use it to draw the ego badge.
// - `distance.get(layerIdx)` gives the BFS distance from the corresponding
//   ego. Useful for distance-based styling. Single-ego = `{ 0: n }`.
//
// All functions are pure — no Vue, no D3. Tests live in the panel via
// real-data browser smoke (per the project's testing policy).

export function fromEgoPayload(payload, layerIdx = 0) {
  if (!payload) return { nodes: [], edges: [] }
  const nodes = payload.nodes.map(n => ({
    id: n.id,
    type: n.type,
    degree: n.degree,
    layers: new Set([layerIdx]),
    isEgoOf: new Set(n.distance === 0 ? [layerIdx] : []),
    distance: new Map([[layerIdx, n.distance]]),
  }))
  const edges = payload.edges.map(e => ({
    source: e.source,
    target: e.target,
    type: e.type,
    layers: new Set([layerIdx]),
  }))
  return { nodes, edges }
}

// Union of several layered graphs into one. Nodes union by id; edges union by
// (source, target, type) so multi-edges across layers collapse cleanly.
export function mergeLayers(layers) {
  const nodeMap = new Map()
  const edgeMap = new Map()
  for (const g of layers) {
    if (!g) continue
    for (const n of g.nodes) {
      const cur = nodeMap.get(n.id)
      if (cur) {
        for (const li of n.layers) cur.layers.add(li)
        for (const li of n.isEgoOf) cur.isEgoOf.add(li)
        for (const [li, d] of n.distance) cur.distance.set(li, d)
      } else {
        nodeMap.set(n.id, {
          id: n.id,
          type: n.type,
          degree: n.degree,
          layers: new Set(n.layers),
          isEgoOf: new Set(n.isEgoOf),
          distance: new Map(n.distance),
        })
      }
    }
    for (const e of g.edges) {
      const key = `${e.source}|${e.target}|${e.type}`
      const cur = edgeMap.get(key)
      if (cur) {
        for (const li of e.layers) cur.layers.add(li)
      } else {
        edgeMap.set(key, {
          source: e.source,
          target: e.target,
          type: e.type,
          layers: new Set(e.layers),
        })
      }
    }
  }
  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] }
}

// Keep only nodes that belong to ≥ minLayers layers, plus the edges where both
// endpoints survive. Used by EgoComparison's "intersection only" view.
export function filterIntersection(graph, minLayers = 2) {
  const kept = new Set(graph.nodes.filter(n => n.layers.size >= minLayers).map(n => n.id))
  return {
    nodes: graph.nodes.filter(n => kept.has(n.id)),
    edges: graph.edges.filter(e => kept.has(e.source) && kept.has(e.target)),
  }
}
