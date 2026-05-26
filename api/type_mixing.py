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

from schema import node_type


def _simple_undirected_projection_all(G):
    """
    Collapse a (possibly multi/directed) graph into a simple undirected graph
    carrying the `Node Type` attribute. Parallel edges → single edge. Self-loops
    excluded. Used for assortativity so Newman's r is interpretable on the
    canonical scale.
    """
    H = nx.Graph()
    for n, d in G.nodes(data=True):
        H.add_node(n, **{k: v for k, v in d.items() if k == 'Node Type'})
    for u, v in G.edges():
        if u != v:
            H.add_edge(u, v)
    return H


def _simple_undirected_projection_for_type(G, edge_type):
    H = nx.Graph()
    for n, d in G.nodes(data=True):
        H.add_node(n, **{k: v for k, v in d.items() if k == 'Node Type'})
    for u, v, d in G.edges(data=True):
        if u != v and d.get('Edge Type', 'Unknown') == edge_type:
            H.add_edge(u, v)
    return H


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
    edge_types = sorted({d.get('Edge Type', 'Unknown') for *_, d in G.edges(data=True)})
    directed = G.is_directed()

    # Assortativity on simple+undirected projection (full graph; frontend caveats under filter).
    H = _simple_undirected_projection_all(G)
    overall = _assortativity_safe(H)
    per_edge_type = {}
    for et in edge_types:
        H_et = _simple_undirected_projection_for_type(G, et)
        per_edge_type[et] = _assortativity_safe(H_et)

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
