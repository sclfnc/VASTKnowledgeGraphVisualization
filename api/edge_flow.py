"""
Edge flow metadata: node/edge type lists, whether the graph is directed, and
per-type node counts. The flow tuples (src_type, edge_type, dst_type) are
recomputed on the client from the edges SoA, so weight, self-loop, and type
filters all apply in the same way — the backend does not depend on the filters.
"""
from collections import Counter

from schema import node_type, edge_type


def compute_edge_flow(G):
    node_types = sorted({node_type(G, n) for n in G.nodes()})
    edge_types = sorted({edge_type(d) for *_, d in G.edges(data=True)})
    directed = G.is_directed()

    node_counts = Counter(node_type(G, n) for n in G.nodes())

    return {
        'node_types': node_types,
        'edge_types': edge_types,
        'directed': directed,
        'node_counts': dict(node_counts),
    }
