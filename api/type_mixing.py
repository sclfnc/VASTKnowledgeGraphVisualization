"""
Type mixing analysis: assortativity + metadata only.

The frontend recomputes the mixing matrix from the edges SoA + activeEdgeMask
so peso/self-loop/type filters propagate uniformly. This module owns only:
- node/edge type lists,
- Newman assortativity (overall + per edge type), too costly to ricomputare
  in JS over thousands of nodes.

Returns:
  {
    node_types: [str],
    edge_types: [str],
    directed: bool,
    assortativity: {
      overall: float | null,
      per_edge_type: { edge_type: float | null },
      method: 'newman_simple_undirected',
      caveat: str
    }
  }
"""
import math

import networkx as nx

from schema import node_type, edge_type


def _build_projections(G):
    """Single edge walk → the simple+undirected projection of the whole graph
    plus one projection per edge type, all in one pass.

    Parallel edges collapse to a single edge; self-loops are excluded. Each
    projection carries the `Node Type` attribute only on the endpoints it
    actually touches — that is all `attribute_assortativity_coefficient` reads
    (isolated nodes don't affect r), so the per-projection node walk is skipped.
    Replaces the previous (1 + #edge_types) full edge walks with one.
    """
    node_types = {n: node_type(G, n) for n in G.nodes()}
    H_all = nx.Graph()
    H_by_type = {}

    def _add(H, u, v):
        if u not in H:
            H.add_node(u, **{'Node Type': node_types[u]})
        if v not in H:
            H.add_node(v, **{'Node Type': node_types[v]})
        H.add_edge(u, v)

    for u, v, d in G.edges(data=True):
        if u == v:
            continue
        _add(H_all, u, v)
        et = edge_type(d)
        H_et = H_by_type.get(et)
        if H_et is None:
            H_et = nx.Graph()
            H_by_type[et] = H_et
        _add(H_et, u, v)
    return H_all, H_by_type


def _assortativity_safe(H):
    # NetworkX returns NaN (no exception) when variance is zero — typically when
    # the graph carries a single Node Type (Les Misérables collapses to one
    # type) or when the projection has no edges. NaN is not JSON-compliant, so
    # surface it as null and let the frontend show "N/A".
    try:
        r = nx.attribute_assortativity_coefficient(H, 'Node Type')
    except Exception:
        return None
    rf = float(r)
    if math.isnan(rf) or math.isinf(rf):
        return None
    return rf


def compute_type_mixing(G):
    node_types = sorted({node_type(G, n) for n in G.nodes()})
    edge_types = sorted({edge_type(d) for *_, d in G.edges(data=True)})
    directed = G.is_directed()

    # Assortativity on simple+undirected projections (full graph; frontend
    # caveats under filter). One edge walk builds the global projection plus one
    # per edge type. An edge type carried only by self-loops has no inter-node
    # structure, so its assortativity is undefined → None (the frontend renders
    # "N/A" and omits it from the per-edge-type bars).
    H_all, H_by_type = _build_projections(G)
    overall = _assortativity_safe(H_all)
    per_edge_type = {
        et: _assortativity_safe(H_by_type[et]) if et in H_by_type else None
        for et in edge_types
    }

    return {
        'node_types': node_types,
        'edge_types': edge_types,
        'directed': directed,
        'assortativity': {
            'overall': overall,
            'per_edge_type': per_edge_type,
            'method': 'newman_simple_undirected',
            'caveat': 'Computed on a simple+undirected projection of the graph (parallel edges collapsed, direction discarded). Self-loops excluded.',
        },
    }
