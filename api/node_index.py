"""Per-node SoA payload for /nodes/. Sorted by degree desc so the i-th
record has the canonical `node_idx = i` shared with /edges/ (source/target
are 0-based indices into this ordering).
"""
import networkx as nx

from registry import Caches, load_graph
from schema import node_type


def _component_membership(G):
    """Return (wcc_of, scc_of): node → 0-based id, size-descending. scc_of is None on undirected."""
    if G.is_directed():
        wcc = sorted(nx.weakly_connected_components(G), key=len, reverse=True)
    else:
        wcc = sorted(nx.connected_components(G), key=len, reverse=True)
    wcc_of = {}
    for cid, nodes in enumerate(wcc):
        for n in nodes:
            wcc_of[n] = cid

    scc_of = None
    if G.is_directed():
        scc = sorted(nx.strongly_connected_components(G), key=len, reverse=True)
        scc_of = {}
        for cid, nodes in enumerate(scc):
            for n in nodes:
                scc_of[n] = cid

    return wcc_of, scc_of


def _build(G):
    """Records sorted by degree desc; ids match /components/ size-desc."""
    wcc_of, scc_of = _component_membership(G)
    records = [{
        'id': str(n),
        '_orig': n,                 # internal: original NX node object for the order map
        'type': node_type(G, n),
        'degree': int(G.degree(n)),
        'wcc_id': int(wcc_of[n]),
        **({'scc_id': int(scc_of[n])} if scc_of is not None else {}),
    } for n in G.nodes()]
    records.sort(key=lambda r: r['degree'], reverse=True)
    return records


def _populate_caches(graph_id: str, G) -> list:
    """Single source of truth: one walk produces both the JSON-safe records
    (cached as `node_index`) and the canonical node order (`node_order`).
    Subsequent reads from either cache skip recomputation."""
    raw = _build(G)
    Caches['node_order'][graph_id] = [r['_orig'] for r in raw]
    payload = [{k: v for k, v in r.items() if k != '_orig'} for r in raw]
    Caches['node_index'][graph_id] = payload
    return payload


def get_node_index(graph_id: str) -> list:
    """Records served by /nodes/. Computes via `_populate_caches` on miss."""
    cached = Caches['node_index'].get(graph_id)
    if cached is not None:
        return cached
    return _populate_caches(graph_id, load_graph(graph_id))


def get_node_order(graph_id: str):
    """Return [original_node, ...] in the canonical (degree-desc) ordering.

    Single source of truth for `source[i]`/`target[i]` indexing in /edges/ —
    edge_index.py uses this to keep node indices coherent across endpoints.
    """
    cached = Caches['node_order'].get(graph_id)
    if cached is not None:
        return cached
    _populate_caches(graph_id, load_graph(graph_id))
    return Caches['node_order'][graph_id]
