"""Edge SoA payload + (u, v[, key]) → edge_id map.

The map and the payload are built together so they share the same ordering:
the i-th record in the SoA arrays has edge_id = i, and the map reverses that
lookup for endpoints that need an `edge_id` from a (u, v[, key]) triple.

Node indices (`source[i]`, `target[i]`) reference the **canonical degree-desc
ordering** shared with `/nodes/` — see `node_index.get_node_order`. This
matches the client's `useGraphNodes.idToIdx` so the AND-with-node-mask step
in `useFilteredModel` reads coherent bits.

Multigraph: keys preserve parallel-edge distinction; map keys are 3-tuples.
Simple graph: keys are 2-tuples (no `key` from G.edges()).
"""
import math

from registry import Caches, load_graph
from node_index import get_node_order


def _build(G, node_order):
    """Walk G.edges in canonical order; build SoA + reverse map together.

    Single pass: weight storage is materialized lazily on the first edge that
    carries a `weight` field, backfilling NaN for any earlier records, so we
    avoid the second pass through G.edges() that the `any()` pre-check did.
    """
    is_multi = G.is_multigraph()
    node_to_idx = {n: i for i, n in enumerate(node_order)}

    edge_types_seen = []
    type_to_idx = {}

    source = []
    target = []
    edge_type_idx = []
    weight = None
    edge_index_map = {}

    iterator = G.edges(keys=True, data=True) if is_multi else G.edges(data=True)

    for record in iterator:
        if is_multi:
            u, v, key, data = record
            map_key = (u, v, key)
        else:
            u, v, data = record
            map_key = (u, v)

        et = data.get('Edge Type', 'Unknown')
        if et not in type_to_idx:
            type_to_idx[et] = len(edge_types_seen)
            edge_types_seen.append(et)

        edge_id = len(source)
        source.append(node_to_idx[u])
        target.append(node_to_idx[v])
        edge_type_idx.append(type_to_idx[et])
        edge_index_map[map_key] = edge_id

        w = data.get('weight')
        if w is not None:
            if weight is None:
                # First weight seen: backfill NaN for prior unweighted records.
                weight = [math.nan] * edge_id
            weight.append(float(w))
        elif weight is not None:
            weight.append(math.nan)

    payload = {
        'source': source,
        'target': target,
        'type': edge_type_idx,
        'edge_types': edge_types_seen,
    }
    if weight is not None:
        payload['weight'] = weight

    return payload, edge_index_map


def get_edge_index(graph_id: str):
    """Return the SoA payload, computing+caching on first access."""
    cache = Caches['edge_index']
    cached = cache.get(graph_id)
    if cached is not None:
        return cached
    G = load_graph(graph_id)
    order = get_node_order(graph_id)
    payload, edge_map = _build(G, order)
    cache[graph_id] = payload
    Caches['edge_index_map'][graph_id] = edge_map
    return payload


def get_edge_index_map(graph_id: str):
    """Return the (u, v[, key]) → edge_id map; build lazily through get_edge_index."""
    cached = Caches['edge_index_map'].get(graph_id)
    if cached is not None:
        return cached
    get_edge_index(graph_id)  # populates both caches
    return Caches['edge_index_map'][graph_id]
