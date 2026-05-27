"""Per-node inspector payload + paginated neighbor list.

`inspect_node` returns a compact envelope (identity + attrs + structural
counters + a small preview of neighbors) suitable as a first paint.
`list_neighbors` is the paginated companion — pulled on demand when the UI
needs to scroll through the full neighborhood of a high-degree hub.

Both endpoints sort neighbors by `degree desc` for deterministic pagination
(stable secondary key on id), with optional direction filter on directed
graphs ('all' | 'in' | 'out').
"""
from typing import Any, Dict, List, Optional

from schema import RESERVED_NODE_ATTRS, node_type


# Preview shipped inside the inspector envelope — keeps the first paint snappy.
NEIGHBOR_SAMPLE_CAP = 12

# Hard cap on a single page of /node-neighbors/ — clamps client `limit`.
NEIGHBOR_PAGE_MAX = 200


def _scalar(v: Any) -> Any:
    """JSON-safe coercion for arbitrary attr values (numpy types, sets, etc.)."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [_scalar(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted(_scalar(x) for x in v)
    if isinstance(v, dict):
        return {str(k): _scalar(val) for k, val in v.items()}
    # numpy scalars, datetimes, anything else → stringify
    try:
        return v.item()
    except AttributeError:
        return str(v)


def _collect_neighbor_records(G, node_id, edge_index_map) -> List[Dict[str, Any]]:
    """Walk every neighbor edge once, returning a flat list of records sorted
    by `degree desc` (secondary key on id). Multigraph: parallel edges yield
    distinct rows, dedup on (other, direction, edge_id).

    Pulled into a helper so `_neighbor_sample` (inspector preview) and
    `list_neighbors` (paginated /node-neighbors/) share one walk + sort path.
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()
    is_multi = G.is_multigraph()
    is_directed = G.is_directed()

    def edge_id_for(u, v, key=None):
        if edge_index_map is None:
            return None
        if is_multi:
            return edge_index_map.get((u, v, key))
        # Undirected SoA was built with a single (u, v) ordering — try both.
        eid = edge_index_map.get((u, v))
        if eid is None and not is_directed:
            eid = edge_index_map.get((v, u))
        return eid

    def push(other, direction: str, edge_data: Dict[str, Any], eid):
        # Dedup key: in multigraph eid disambiguates parallel edges; otherwise
        # (other, direction, edge_type) is unique within a simple graph.
        key = (other, direction, eid) if is_multi else (other, direction)
        if key in seen:
            return
        seen.add(key)
        record = {
            'id': str(other),
            'type': node_type(G, other),
            'direction': direction,
            'edge_type': edge_data.get('Edge Type', 'Unknown'),
            'degree': int(G.degree(other)),
            **({'edge_id': int(eid)} if eid is not None else {}),
        }
        if is_directed:
            record['in_degree'] = int(G.in_degree(other))
            record['out_degree'] = int(G.out_degree(other))
        out.append(record)

    if is_directed:
        for v in G.successors(node_id):
            if is_multi:
                for k, data in G[node_id][v].items():
                    push(v, 'out', data, edge_id_for(node_id, v, k))
            else:
                push(v, 'out', G[node_id][v], edge_id_for(node_id, v))
        for u in G.predecessors(node_id):
            if is_multi:
                for k, data in G[u][node_id].items():
                    push(u, 'in', data, edge_id_for(u, node_id, k))
            else:
                push(u, 'in', G[u][node_id], edge_id_for(u, node_id))
    else:
        for v in G.neighbors(node_id):
            if is_multi:
                for k, data in G[node_id][v].items():
                    push(v, 'neighbor', data, edge_id_for(node_id, v, k))
            else:
                push(v, 'neighbor', G[node_id][v], edge_id_for(node_id, v))

    # Sort by degree desc — the most-connected neighbors are the most likely
    # ones the user wants to inspect. Stable secondary key on id keeps output
    # deterministic across runs (a must for pagination).
    out.sort(key=lambda r: (-r['degree'], r['id']))
    return out


def _filter_by_direction(records: List[Dict[str, Any]], direction: str) -> List[Dict[str, Any]]:
    """Direction filter ('all' | 'in' | 'out'). Undirected graphs have
    direction='neighbor' so 'in'/'out' would yield an empty list — caller
    enforces undirected ⇒ 'all'."""
    if direction == 'all' or direction == 'neighbor':
        return records
    return [r for r in records if r['direction'] == direction]


def list_neighbors(G, node_id: str, edge_index_map, direction: str = 'all',
                   offset: int = 0, limit: int = 50) -> Dict[str, Any]:
    """Paginated neighbor list. Total count is the unfiltered degree; the
    `filtered_total` field is the count after direction filtering (so the UI
    can render "X of Y" captions correctly under direction toggles).

    Raises KeyError if the node is missing — caller maps to HTTP 404.
    """
    node_id = _resolve_node_key(G, node_id)

    records = _collect_neighbor_records(G, node_id, edge_index_map)
    if not G.is_directed():
        direction = 'all'  # 'in'/'out' meaningless on undirected
    filtered = _filter_by_direction(records, direction)

    # Clamp pagination params.
    if offset < 0:
        offset = 0
    if limit <= 0:
        limit = 50
    if limit > NEIGHBOR_PAGE_MAX:
        limit = NEIGHBOR_PAGE_MAX

    page = filtered[offset:offset + limit]
    return {
        'items': page,
        'offset': offset,
        'limit': limit,
        'returned': len(page),
        'filtered_total': len(filtered),
        'total': len(records),
        'direction': direction,
    }


def _resolve_node_key(G, node_id):
    """`/nodes/` ships ids stringified, but built-in datasets (Karate,
    MovieLens, etc.) keep integer keys inside the graph. Try the string first,
    then int() — fail with KeyError matching the requested id."""
    if node_id in G:
        return node_id
    try:
        as_int = int(node_id)
    except (TypeError, ValueError):
        raise KeyError(node_id)
    if as_int in G:
        return as_int
    raise KeyError(node_id)


def inspect_node(G, node_id: str, edge_index_map=None) -> Dict[str, Any]:
    """Return JSON-ready inspector payload for `node_id`.

    `edge_index_map` (optional): (u, v[, key]) → edge_id from edge_index.py.
    When provided, neighbor records carry the canonical edge_id so the UI can
    open /edge-inspect/ on click. When None, edges in the neighbor list are
    informational only.

    Raises KeyError if the node is missing — caller maps to HTTP 404.
    """
    node_id = _resolve_node_key(G, node_id)

    data = dict(G.nodes[node_id])
    nt = node_type(G, node_id)

    # Split raw attrs into "reserved" (Node Type — surfaced separately) and
    # "user" so the UI can group them.
    user_attrs: Dict[str, Any] = {}
    for k, v in data.items():
        if k in RESERVED_NODE_ATTRS:
            continue
        user_attrs[k] = _scalar(v)

    is_directed = G.is_directed()
    structural: Dict[str, Any] = {
        'degree': int(G.degree(node_id)),
    }
    if is_directed:
        structural['in_degree'] = int(G.in_degree(node_id))
        structural['out_degree'] = int(G.out_degree(node_id))

    return {
        'id': str(node_id),
        'type': nt,
        'attributes': user_attrs,
        'structural': structural,
        'neighbors': _collect_neighbor_records(G, node_id, edge_index_map)[:NEIGHBOR_SAMPLE_CAP],
        'neighbor_total': int(G.degree(node_id)),
    }
