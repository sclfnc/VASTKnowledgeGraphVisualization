"""Per-edge inspector payload for the EdgeInspector sidebar section.

The `edge_id` is the global index from `/edges/` (the canonical walk of
`G.edges(keys=True)` on multigraph, `G.edges()` otherwise — see edge_index.py).
We invert `edge_index_map` ((u, v[, key]) → edge_id) to recover the triple and
then read the underlying edge attributes from G.
"""
from typing import Any, Dict

from edge_index import get_edge_index, get_edge_index_map
from schema import RESERVED_EDGE_ATTRS, node_type


def _scalar(v: Any) -> Any:
    """JSON-safe coercion (mirrors node_inspect._scalar)."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [_scalar(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted(_scalar(x) for x in v)
    if isinstance(v, dict):
        return {str(k): _scalar(val) for k, val in v.items()}
    try:
        return v.item()
    except AttributeError:
        return str(v)


def inspect_edge(graph_id: str, G, edge_id: int) -> Dict[str, Any]:
    """Return JSON-ready inspector payload for a specific edge_id.

    Raises KeyError if the id is out of range — caller maps to HTTP 404.
    """
    # Populate both caches if needed, then reverse-map. Reverse construction is
    # O(E); fine for our scale and called only on user clicks.
    payload = get_edge_index(graph_id)
    edge_map = get_edge_index_map(graph_id)
    total = len(payload['source'])
    if edge_id < 0 or edge_id >= total:
        raise KeyError(edge_id)

    triple = None
    for key, eid in edge_map.items():
        if eid == edge_id:
            triple = key
            break
    if triple is None:
        raise KeyError(edge_id)

    is_multi = G.is_multigraph()
    if is_multi:
        u, v, key = triple
        data = dict(G[u][v][key])
    else:
        u, v = triple
        data = dict(G[u][v])

    edge_type = data.get('Edge Type', 'Unknown')

    user_attrs: Dict[str, Any] = {}
    for k, val in data.items():
        if k in RESERVED_EDGE_ATTRS:
            continue
        user_attrs[k] = _scalar(val)

    return {
        'edge_id': int(edge_id),
        'edge_type': edge_type,
        'directed': bool(G.is_directed()),
        'source': {'id': str(u), 'type': node_type(G, u)},
        'target': {'id': str(v), 'type': node_type(G, v)},
        **({'key': key} if is_multi else {}),
        'attributes': user_attrs,
    }
