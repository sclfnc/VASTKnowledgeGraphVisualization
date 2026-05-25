"""
Edge type flow analysis: tripartite NodeType→EdgeType→NodeType counts,
rendered client-side as a compact meta-graph (node-types as nodes,
edge-types as labeled/colored arcs).

Counting:
- Directed: each edge contributes 1 to (src_type, edge_type, dst_type).
  Direction preserved verbatim — no canonicalization.
- Undirected: each edge contributes 1 to (min_type, edge_type, max_type)
  by lexicographic order, so each pair is reported once.
- Multigraph: parallel edges count individually.
"""
from collections import Counter

from schema import node_type


def compute_edge_flow(G):
    node_types = sorted({node_type(G, n) for n in G.nodes()})
    edge_types = sorted({d.get('Edge Type', 'Unknown') for *_, d in G.edges(data=True)})
    directed = G.is_directed()

    node_counts = Counter(node_type(G, n) for n in G.nodes())

    flow_counts = Counter()
    if G.is_multigraph():
        edges_iter = ((u, v, d) for u, v, _k, d in G.edges(data=True, keys=True))
    else:
        edges_iter = ((u, v, d) for u, v, d in G.edges(data=True))

    for u, v, d in edges_iter:
        st = node_type(G, u)
        dt = node_type(G, v)
        et = d.get('Edge Type', 'Unknown')
        if not directed and st > dt:
            st, dt = dt, st
        flow_counts[(st, et, dt)] += 1

    flows = [
        {'src_type': k[0], 'edge_type': k[1], 'dst_type': k[2], 'count': v}
        for k, v in sorted(flow_counts.items(), key=lambda x: -x[1])
    ]

    return {
        'node_types': node_types,
        'edge_types': edge_types,
        'directed': directed,
        'node_counts': dict(node_counts),
        'flows': flows,
    }
