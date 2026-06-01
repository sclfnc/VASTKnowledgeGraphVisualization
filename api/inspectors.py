"""Inspector payloads for the sidebar — node and edge, unified (they're duals
and share the same attr-coercion + reserved-key split).

- `inspect_node` / `list_neighbors`: per-node envelope + paginated neighbor list.
  Neighbors sorted `degree desc` (stable secondary key on id) for deterministic
  pagination, with an optional direction filter on directed graphs.
- `inspect_edge`: per-edge payload, recovered from `edge_index_map` ((u,v[,key])
  → edge_id) inverted on demand.

JSON coercion (`json_scalar`) and the type lookups (`node_type`, `edge_type`)
live in schema.py — single source of truth.
"""
from typing import Any, Dict, List

from schema import (
    RESERVED_NODE_ATTRS, RESERVED_EDGE_ATTRS,
    node_type, edge_type, json_scalar,
)
from edge_index import get_edge_index, get_edge_index_map


# Preview shipped inside the node inspector envelope — keeps first paint snappy.
NEIGHBOR_SAMPLE_CAP = 12
# Hard cap on a single page of /node-neighbors/ — clamps client `limit`.
NEIGHBOR_PAGE_MAX = 200


# ---------------------------------------------------------------------------
# Node inspector
# ---------------------------------------------------------------------------

def _resolve_node_key(G, node_id):
    """`/nodes/` ships ids stringified, but built-in datasets keep integer keys.
    Try the string first, then int(); KeyError matches the requested id."""
    if node_id in G:
        return node_id
    try:
        as_int = int(node_id)
    except (TypeError, ValueError):
        raise KeyError(node_id)
    if as_int in G:
        return as_int
    raise KeyError(node_id)


def _collect_neighbor_records(G, node_id, edge_index_map) -> List[Dict[str, Any]]:
    """Walk every neighbor edge once → flat list sorted by `degree desc`
    (secondary key on id). Multigraph: parallel edges yield distinct rows,
    dedup on (other, direction, edge_id). Shared by the preview and the
    paginated list so there's one walk + sort path."""
    out: List[Dict[str, Any]] = []
    seen: set = set()
    is_multi = G.is_multigraph()
    is_directed = G.is_directed()

    def edge_id_for(u, v, key=None):
        if edge_index_map is None:
            return None
        if is_multi:
            return edge_index_map.get((u, v, key))
        eid = edge_index_map.get((u, v))
        if eid is None and not is_directed:
            eid = edge_index_map.get((v, u))
        return eid

    def push(other, direction: str, edge_data: Dict[str, Any], eid):
        key = (other, direction, eid) if is_multi else (other, direction)
        if key in seen:
            return
        seen.add(key)
        record = {
            'id': str(other),
            'type': node_type(G, other),
            'direction': direction,
            'edge_type': edge_type(edge_data),
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

    out.sort(key=lambda r: (-r['degree'], r['id']))
    return out


def _filter_by_direction(records: List[Dict[str, Any]], direction: str) -> List[Dict[str, Any]]:
    """'all' | 'in' | 'out'. Undirected records have direction='neighbor', so
    'in'/'out' would be empty — caller enforces undirected ⇒ 'all'."""
    if direction == 'all' or direction == 'neighbor':
        return records
    return [r for r in records if r['direction'] == direction]


def list_neighbors(G, node_id: str, edge_index_map, direction: str = 'all',
                   offset: int = 0, limit: int = 50) -> Dict[str, Any]:
    """Paginated neighbor list. `total` is the unfiltered count; `filtered_total`
    is after direction filtering (UI "X of Y" captions). KeyError → HTTP 404."""
    node_id = _resolve_node_key(G, node_id)

    records = _collect_neighbor_records(G, node_id, edge_index_map)
    if not G.is_directed():
        direction = 'all'
    filtered = _filter_by_direction(records, direction)

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


def inspect_node(G, node_id: str, edge_index_map=None) -> Dict[str, Any]:
    """Per-node inspector payload. `edge_index_map` (optional) lets neighbor
    records carry the canonical edge_id for /edge-inspect/ on click.
    KeyError if the node is missing → HTTP 404."""
    node_id = _resolve_node_key(G, node_id)

    data = dict(G.nodes[node_id])
    user_attrs = {k: json_scalar(v) for k, v in data.items() if k not in RESERVED_NODE_ATTRS}

    structural: Dict[str, Any] = {'degree': int(G.degree(node_id))}
    if G.is_directed():
        structural['in_degree'] = int(G.in_degree(node_id))
        structural['out_degree'] = int(G.out_degree(node_id))

    return {
        'id': str(node_id),
        'type': node_type(G, node_id),
        'attributes': user_attrs,
        'structural': structural,
        'neighbors': _collect_neighbor_records(G, node_id, edge_index_map)[:NEIGHBOR_SAMPLE_CAP],
        'neighbor_total': int(G.degree(node_id)),
    }


# ---------------------------------------------------------------------------
# Edge inspector
# ---------------------------------------------------------------------------

def inspect_edge(graph_id: str, G, edge_id: int) -> Dict[str, Any]:
    """Per-edge inspector payload, recovered from the inverted edge_index_map.
    Reverse construction is O(E) — fine, called only on user clicks.
    KeyError if the id is out of range → HTTP 404."""
    payload = get_edge_index(graph_id)
    edge_map = get_edge_index_map(graph_id)
    total = len(payload['source'])
    if edge_id < 0 or edge_id >= total:
        raise KeyError(edge_id)

    triple = next((key for key, eid in edge_map.items() if eid == edge_id), None)
    if triple is None:
        raise KeyError(edge_id)

    is_multi = G.is_multigraph()
    if is_multi:
        u, v, key = triple
        data = dict(G[u][v][key])
    else:
        u, v = triple
        data = dict(G[u][v])

    user_attrs = {k: json_scalar(val) for k, val in data.items() if k not in RESERVED_EDGE_ATTRS}

    return {
        'edge_id': int(edge_id),
        'edge_type': edge_type(data),
        'directed': bool(G.is_directed()),
        'source': {'id': str(u), 'type': node_type(G, u)},
        'target': {'id': str(v), 'type': node_type(G, v)},
        **({'key': key} if is_multi else {}),
        'attributes': user_attrs,
    }
