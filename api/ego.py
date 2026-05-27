"""Per-request k-hop ego BFS with stratified sampling by type; hard limits protect against hubs."""
import time

from schema import node_type

HARD_NODE_LIMIT = 2500
HARD_TIMEOUT_MS = 1500
SOFT_CAP_DEFAULT = 300
LRU_SIZE = 64

# 'out' = successors, 'in' = predecessors, 'both' = union (undirected walk).
# Ignored on undirected graphs (all three collapse to G.neighbors).
VALID_DIRECTIONS = ('out', 'in', 'both')


class EgoTooLargeError(Exception):
    """Raised when BFS exceeds the hard node or time limit."""
    pass


def _bfs_layers(G, ego, k, hard_cap, hard_timeout_ms, direction='out'):
    """BFS to depth k → {node → distance}. Raises EgoTooLargeError on cap or timeout."""
    start = time.monotonic()
    deadline_s = hard_timeout_ms / 1000.0

    visited = {ego: 0}
    frontier = [ego]
    if G.is_directed():
        if direction == 'in':
            neighbors = G.predecessors
        elif direction == 'both':
            def neighbors(u):
                # Dedup happens via the visited check below.
                yield from G.successors(u)
                yield from G.predecessors(u)
        else:
            neighbors = G.successors
    else:
        neighbors = G.neighbors
    successors = neighbors

    # Periodic timeout check inside the inner loop too, so a single hub with
    # 100k+ neighbors can't run away before reaching the next outer iteration.
    TIMEOUT_CHECK_STRIDE = 1024
    inner_counter = 0
    for depth in range(1, k + 1):
        next_frontier = []
        for u in frontier:
            for v in successors(u):
                if v in visited:
                    continue
                visited[v] = depth
                next_frontier.append(v)
                if len(visited) > hard_cap:
                    raise EgoTooLargeError(
                        f"Ego too large at k={k}: {len(visited)} neighbors. "
                        "Reduce k-hop or pick a less central node."
                    )
                inner_counter += 1
                if inner_counter >= TIMEOUT_CHECK_STRIDE:
                    inner_counter = 0
                    if (time.monotonic() - start) > deadline_s:
                        raise EgoTooLargeError(
                            f"BFS exceeded {hard_timeout_ms}ms at depth {depth}. "
                            "Reduce k-hop or pick a less central node."
                        )
            if (time.monotonic() - start) > deadline_s:
                raise EgoTooLargeError(
                    f"BFS exceeded {hard_timeout_ms}ms at depth {depth}. "
                    "Reduce k-hop or pick a less central node."
                )
        frontier = next_frontier
        if not frontier:
            break

    return visited


def _stratified_sample(G, alters, soft_cap):
    """Round-robin pick from per-type buckets; preserves rare-type signals (e.g. Song-ego on MC1).
    Buckets are ordered by their original BFS-insertion order so picks are
    deterministic across calls. Within a bucket, higher-degree alters come
    first (sort by full-graph degree desc) so the sample carries the locally
    important nodes.
    """
    buckets = {}
    for a in alters:
        t = node_type(G, a)
        buckets.setdefault(t, []).append(a)
    for t in buckets:
        buckets[t].sort(key=lambda n: G.degree(n), reverse=True)

    picked = []
    bucket_keys = list(buckets.keys())
    idx = {t: 0 for t in bucket_keys}
    while len(picked) < soft_cap:
        progressed = False
        for t in bucket_keys:
            if idx[t] < len(buckets[t]):
                picked.append(buckets[t][idx[t]])
                idx[t] += 1
                progressed = True
                if len(picked) >= soft_cap:
                    break
        if not progressed:
            break
    return picked


def ego_subgraph(G, node_id, k, soft_cap, direction='out', edge_index_map=None,
                 hard_cap=HARD_NODE_LIMIT, hard_timeout_ms=HARD_TIMEOUT_MS):
    """k-hop ego subgraph. Raises KeyError (→404) or EgoTooLargeError (→422).

    `edge_index_map`: optional (u, v[, key]) → edge_id mapping. When provided,
    each edge record carries `edge_id` for client-side filter mask lookups.
    """
    # Path params arrive as strings; built-in datasets keep int ids — try both before failing.
    if node_id in G:
        ego = node_id
    else:
        try:
            ego = int(node_id)
        except (TypeError, ValueError):
            raise KeyError(node_id)
        if ego not in G:
            raise KeyError(node_id)

    visited = _bfs_layers(G, ego, k, hard_cap, hard_timeout_ms, direction)

    alters = [n for n in visited if n != ego]
    total_before_cap = len(alters)

    if total_before_cap > soft_cap:
        alters = _stratified_sample(G, alters, soft_cap)
        sampling = 'stratified'
        truncated = True
    else:
        sampling = 'none'
        truncated = False

    keep = {ego, *alters}
    sub = G.subgraph(keep)

    nodes = [{
        'id': str(n),
        'type': node_type(G, n),
        'degree': int(G.degree(n)),
        'distance': visited[n],
    } for n in keep]

    edges = []
    is_multi = G.is_multigraph()
    edge_iter = sub.edges(keys=True, data=True) if is_multi else sub.edges(data=True)
    for record in edge_iter:
        if is_multi:
            u, v, key, data = record
            map_key = (u, v, key)
        else:
            u, v, data = record
            map_key = (u, v)
        entry = {
            'source': str(u),
            'target': str(v),
            'type': data.get('Edge Type', 'Unknown'),
        }
        if edge_index_map is not None:
            edge_id = edge_index_map.get(map_key)
            if edge_id is not None:
                entry['edge_id'] = edge_id
        edges.append(entry)

    return {
        'nodes': nodes,
        'edges': edges,
        'truncated': truncated,
        'total_before_cap': total_before_cap,
        'sampling': sampling,
        'cap_effective': soft_cap,
    }
