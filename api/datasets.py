"""
Built-in dataset handlers.

`builtin_summary(name)` powers the onboarding picker (eager structural flags
without a follow-up /schema/ call). `load_builtin(name)` materializes a
built-in graph to disk and returns the `graph_id` — the endpoint in main.py
is a thin wrapper around it.
"""
import json

import networkx as nx
from fastapi import HTTPException

from registry import builtin_summary_cache, graph_path, register_graph
from schema import BUILTIN_DATASETS, compute_schema, normalize_builtin_types


def builtin_summary(name: str):
    """
    Lazy-built, cached summary of a built-in dataset. Drives the onboarding
    picker so it can show structural flags without a follow-up /schema/ call.
    """
    cached = builtin_summary_cache.get(name)
    if cached is not None:
        return cached
    loader_fn, _ = BUILTIN_DATASETS[name]
    graph = loader_fn()
    normalize_builtin_types(name, graph)
    schema = compute_schema(graph, name=name.replace('_', ' ').title())
    summary = {
        'nodes': schema['nodes'],
        'edges': schema['edges'],
        'directed': schema['directed'],
        'weighted': schema['weighted'],
        'multigraph': schema['multigraph'],
        'bipartite': schema.get('bipartite', False),
        'node_types': len(schema['node_types']),
        'edge_types': len(schema['edge_types']),
    }
    builtin_summary_cache[name] = summary
    return summary


def list_builtin_payload():
    """Build the /datasets/ response (built-in list with eager summaries)."""
    return {
        "datasets": [
            {"name": name, "description": desc, **builtin_summary(name)}
            for name, (_, desc) in BUILTIN_DATASETS.items()
        ]
    }


def load_builtin_payload(name: str):
    """
    Materialize a built-in graph to disk, register it, return the graph_id.
    Raises HTTPException(404) if the name is unknown.
    Note: kickoff() of the centrality precompute is the caller's job — the
    handler in main.py drains in-flight tasks first.
    """
    if name not in BUILTIN_DATASETS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown dataset '{name}'. Available: {list(BUILTIN_DATASETS)}",
        )
    loader_fn, _ = BUILTIN_DATASETS[name]
    graph = loader_fn()
    normalize_builtin_types(name, graph)

    graph_id = f"builtin_{name}"
    file_path = graph_path(graph_id)
    with open(file_path, "w") as f:
        json.dump(nx.node_link_data(graph), f)

    register_graph(graph_id, file_path, name.replace('_', ' ').title())
    return graph_id
