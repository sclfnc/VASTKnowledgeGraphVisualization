"""
Type mixing analysis for the Type Mixing Matrix panel.

Two modes:
- 'edges': cell (i,j) = number of edges from node-type i to node-type j.
  Computed on the multigraph as-is: parallel edges count individually.
- 'nodes': cell (i,j) = number of distinct type-j nodes that are 1-hop
  reachable (i.e. direct neighbors, NOT transitive closure) from any
  type-i node. On directed graphs uses successors; on undirected, neighbors.

Returns:
  {
    node_types: [str],
    edge_types: [str],
    directed: bool,
    edges: {
      counts: { type_i: { type_j: int } },
      by_edge_type: { edge_type: { type_i: { type_j: int } } }
    },
    nodes: {
      counts: { type_i: { type_j: int } }
    },
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


def _empty_matrix(node_types):
    return {t: {u: 0 for u in node_types} for t in node_types}


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

    # ── Edges mode ──────────────────────────────────────────────────────
    counts = _empty_matrix(node_types)
    by_edge_type = {}

    if G.is_multigraph():
        edges_iter = ((u, v, d) for u, v, _k, d in G.edges(data=True, keys=True))
    else:
        edges_iter = ((u, v, d) for u, v, d in G.edges(data=True))

    for u, v, d in edges_iter:
        st = node_type(G, u)
        dt = node_type(G, v)
        et = d.get('Edge Type', 'Unknown')
        counts[st][dt] += 1
        by_edge_type.setdefault(et, _empty_matrix(node_types))
        by_edge_type[et][st][dt] += 1

    # ── Nodes mode (1-hop neighbor-set sizes) ───────────────────────────
    node_mode_counts = _empty_matrix(node_types)
    nodes_by_type = {}
    for n in G.nodes():
        nodes_by_type.setdefault(node_type(G, n), set()).add(n)

    for src_type, src_nodes in nodes_by_type.items():
        reachable_by_dst = {}
        for u in src_nodes:
            neighbors = G.successors(u) if directed else G.neighbors(u)
            for v in neighbors:
                reachable_by_dst.setdefault(node_type(G, v), set()).add(v)
        for dst_type, dst_nodes_reached in reachable_by_dst.items():
            node_mode_counts[src_type][dst_type] = len(dst_nodes_reached)

    # ── Assortativity on simple+undirected projection ───────────────────
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
        'edges': {
            'counts': counts,
            'by_edge_type': by_edge_type,
        },
        'nodes': {
            'counts': node_mode_counts,
        },
        'assortativity': {
            'overall': overall,
            'per_edge_type': per_edge_type,
            'method': 'newman_simple_undirected',
            'caveat': 'Computed on a simple+undirected projection of the graph (parallel edges collapsed, direction discarded). Self-loops excluded.',
        },
    }
