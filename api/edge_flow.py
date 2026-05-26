"""
Edge flow metadata: node/edge type lists, directedness, and per-type
node counts. Flow tuples (src_type, edge_type, dst_type) are recomputed
client-side from the edges SoA so peso/self-loop/type filters propagate
uniformly — backend stays stateless w.r.t. filters.
"""
from collections import Counter

from schema import node_type


def compute_edge_flow(G):
    node_types = sorted({node_type(G, n) for n in G.nodes()})
    edge_types = sorted({d.get('Edge Type', 'Unknown') for *_, d in G.edges(data=True)})
    directed = G.is_directed()

    node_counts = Counter(node_type(G, n) for n in G.nodes())

    return {
        'node_types': node_types,
        'edge_types': edge_types,
        'directed': directed,
        'node_counts': dict(node_counts),
    }
