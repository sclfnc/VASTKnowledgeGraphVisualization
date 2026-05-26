"""In-memory registry of loaded graphs + per-endpoint result caches. Process-lifetime only."""
import json
import os
from collections import OrderedDict
from types import MappingProxyType
from typing import Dict, Any, Tuple
from pathlib import Path

from fastapi import HTTPException

from schema import load_node_link

# Created at import time so the upload endpoint can write without checks.
GRAPH_STORAGE_DIR = "graph_storage"
Path(GRAPH_STORAGE_DIR).mkdir(exist_ok=True)

# graph_id → file path / display name.
graph_registry: Dict[str, str] = {}
graph_names: Dict[str, str] = {}

# Per-endpoint result caches keyed by graph_id; invalidated together on (re)register.
# Specialized caches (non-`Dict[str, Any]` shape) live outside and pop explicitly below.
Caches: Dict[str, Dict[str, Any]] = {
    'schema': {},
    'degree_fit': {},
    'components': {},
    'node_index': {},        # JSON-safe records served by /nodes/
    'node_order': {},        # canonical [orig_node, ...] degree-desc, shared with /edges/
    'edge_index': {},        # SoA payload served by /edges/
    'edge_index_map': {},    # (u, v[, key]) → edge_id, mirrors edge_index ordering
    'graph_object': {},
    'edge_flow': {},
    'type_mixing': {},
    # Value is `Dict[overrides_key, payload]`; .pop() still wipes the whole graph_id entry.
    'timeline': {},
}

# Ego LRU keyed by (graph_id, node_id, k, cap); OrderedDict for move_to_end + popitem(last=False).
ego_subgraph_cache: "OrderedDict[Tuple[str, str, int, int], Any]" = OrderedDict()

# Per-measure status (pending/computing/ready/error/cancelled) + payload + asyncio handles.
centrality_status: Dict[str, Dict[str, str]] = {}
centrality_cache: Dict[str, Dict[str, Any]] = {}
precompute_tasks: Dict[str, Any] = {}
precompute_locks: Dict[str, Any] = {}

# Frozen template; use `dict(EMPTY_CENTRALITY_STATUS)` for a fresh per-graph copy.
EMPTY_CENTRALITY_STATUS = MappingProxyType({
    'spectral': 'pending',
    'betweenness': 'pending',
    'closeness': 'pending',
})

# Keyed by built-in name (not graph_id); built-ins are immutable.
builtin_summary_cache: Dict[str, Any] = {}


def graph_path(graph_id: str) -> str:
    """Filesystem path where a graph is (or will be) stored."""
    return os.path.join(GRAPH_STORAGE_DIR, f"{graph_id}.json")


def load_graph(graph_id: str):
    """Resolve graph_id → memoized NetworkX graph; 404 if unknown."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    cached = Caches['graph_object'].get(graph_id)
    if cached is not None:
        return cached
    with open(graph_registry[graph_id]) as f:
        G = load_node_link(json.load(f))
    Caches['graph_object'][graph_id] = G
    return G


def invalidate_caches(graph_id: str) -> None:
    """Drop all cached state for graph_id; add specialized (non-`Dict[str, Any]`) caches here."""
    for cache in Caches.values():
        cache.pop(graph_id, None)
    centrality_status.pop(graph_id, None)
    centrality_cache.pop(graph_id, None)
    precompute_locks.pop(graph_id, None)
    precompute_tasks.pop(graph_id, None)
    # Snapshot keys: concurrent /ego/ insert under the GIL would raise during iteration.
    for key in list(ego_subgraph_cache.keys()):
        if key[0] == graph_id:
            ego_subgraph_cache.pop(key, None)


def register_graph(graph_id: str, file_path: str, name: str) -> None:
    """Atomic registration: path + display name + cache wipe."""
    graph_registry[graph_id] = file_path
    graph_names[graph_id] = name
    invalidate_caches(graph_id)
