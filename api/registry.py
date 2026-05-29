"""In-memory registry of loaded graphs + per-endpoint result caches. Process-lifetime only."""
import json
import os
import threading
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
    # Per-(type, attr) precomputed index for v2 filter pipeline.
    'attribute_index': {},
    # Per-item effective_type labels (auto- or manually-promoted attribute);
    # value is `Dict[(node_attr, edge_attr) override key, payload]` so manual
    # promotion (Phase 7+) slots in without backend touches.
    'effective_types': {},
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


# Per-graph load locks: prevent two concurrent requests from parsing the same
# graph file twice (RAM spike + wasted CPU). The lock dict itself is mutated
# under a coarse lock to avoid creating two locks for the same graph_id.
_load_locks_mutex = threading.Lock()
_load_locks: Dict[str, threading.Lock] = {}


def _load_lock_for(graph_id: str) -> threading.Lock:
    with _load_locks_mutex:
        lock = _load_locks.get(graph_id)
        if lock is None:
            lock = threading.Lock()
            _load_locks[graph_id] = lock
        return lock


def load_graph(graph_id: str):
    """Resolve graph_id → memoized NetworkX graph; 404 if unknown."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    cached = Caches['graph_object'].get(graph_id)
    if cached is not None:
        return cached
    # Serialize concurrent first-loads of the same graph (avoid double parse).
    with _load_lock_for(graph_id):
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
    # Drop the per-graph load lock too — no point keeping it if state is gone.
    with _load_locks_mutex:
        _load_locks.pop(graph_id, None)


def _prune_orphan_uploads() -> None:
    """Delete uploaded graph files no longer referenced by the registry.

    Uploads land as `<uuid>.json` and were never cleaned up — they piled up
    indefinitely (each MC1 upload is ~6.5 MB). On every (re)registration we drop
    the on-disk files whose graph_id is no longer in the registry. Built-ins
    (`builtin_*.json`, rebuilt on load) and the source data folder
    (`builtin_data/`) are left untouched. Failures are swallowed: cleanup must
    never break a registration.
    """
    try:
        for entry in os.scandir(GRAPH_STORAGE_DIR):
            if not entry.is_file() or not entry.name.endswith('.json'):
                continue
            if entry.name.startswith('builtin_') or entry.name == 'default-graph.json':
                continue
            graph_id = entry.name[:-len('.json')]
            if graph_id not in graph_registry:
                try:
                    os.remove(entry.path)
                except OSError:
                    pass
    except OSError:
        pass


def register_graph(graph_id: str, file_path: str, name: str) -> None:
    """Atomic registration: path + display name + cache wipe + orphan cleanup."""
    graph_registry[graph_id] = file_path
    graph_names[graph_id] = name
    invalidate_caches(graph_id)
    _prune_orphan_uploads()
