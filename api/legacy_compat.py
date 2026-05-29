"""Upstream-compatibility layer — DO NOT fold into the modular backend.

These endpoints (`/summary/`, `/node-types/`, `/edge-types/`, `/set-default/`) and the
`default_graph_id` constant come from the **original** API on the shared repository. They are
kept here, byte-for-byte in behaviour, so the upstream `tests/` suite passes unchanged and this
backend lands as an *additive* PR rather than a replacement.

Everything in this file is "upstream original". The rest of the backend (the 23 modular
endpoints) is new. The two are deliberately separated so the distinction is obvious and this
shim can be deleted wholesale once the group migrates to the modular contract.

Note: the legacy endpoints intentionally do NOT use the modular `registry.load_graph` /
`schema.*` helpers. The upstream `/set-default/` accepts a graph_id that is a *filename* in
`graph_storage/` not yet in the registry, and loads it from disk — a path the modular
`load_graph` (404 on unknown id) does not support. Replicating their load-or-file logic here
keeps the modular core clean.
"""
import json
import os

import networkx as nx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from registry import graph_registry, GRAPH_STORAGE_DIR

# Special id: `/summary/default`, `/node-types/default`, … resolve to whatever
# `/set-default/{id}` last pointed at. Imported by tests via `from main import …`.
default_graph_id = "default"

router = APIRouter()


def _load_registered_graph(graph_id: str):
    """Load a graph that is already in the registry. 404 if unknown.

    Upstream reads `id → file_path` from the registry and parses the file every
    call (no caching) — kept identical so behaviour matches the tests exactly.
    """
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    with open(graph_registry[graph_id], 'r') as f:
        data = json.load(f)
    return nx.node_link_graph(data, edges="links" if "links" in data else "edges")


def create_degree_centrality_distribution(graph):
    """Adaptive-binned degree-centrality histogram (upstream verbatim).

    10 evenly-spaced bins over the actual value range, plus a `stats` block.
    Empty graph → just the zeroed `stats`.
    """
    values = list(nx.degree_centrality(graph).values())
    if not values:
        return {"stats": {"min": 0, "max": 0, "mean": 0, "median": 0, "total_nodes": 0}}

    min_val, max_val = min(values), max(values)
    if min_val == max_val:
        bins = [min_val, min_val]
    else:
        bins = [min_val + i * (max_val - min_val) / 10 for i in range(11)]

    distribution = {}
    for i in range(len(bins) - 1):
        lower, upper = bins[i], bins[i + 1]
        distribution[f"{lower:.4f}-{upper:.4f}"] = sum(1 for v in values if lower <= v < upper)

    distribution["stats"] = {
        "min": min_val,
        "max": max_val,
        "mean": sum(values) / len(values),
        "median": sorted(values)[len(values) // 2],
        "total_nodes": len(values),
    }
    return distribution


@router.post("/set-default/{graph_id}", summary="[legacy] Set a graph as the default graph")
def set_default_graph(graph_id: str):
    """Point `default_graph_id` at an existing graph_id OR a filename in
    graph_storage/ (with or without .json). Upstream contract."""
    if graph_id in graph_registry:
        file_path = graph_registry[graph_id]
    else:
        file_path = os.path.join(GRAPH_STORAGE_DIR, f"{graph_id}.json")
        if not os.path.exists(file_path):
            file_path = os.path.join(GRAPH_STORAGE_DIR, graph_id)
            if not os.path.exists(file_path):
                raise HTTPException(status_code=404,
                                    detail="Graph ID not found in registry or storage")
        graph_registry[graph_id] = file_path

    graph_registry[default_graph_id] = file_path
    return JSONResponse(status_code=200, content={
        "message": "Graph set as default successfully",
        "default_graph_id": default_graph_id,
        "graph_id": graph_id,
    })


@router.get("/summary/{graph_id}", summary="[legacy] Get graph summary by ID")
def get_graph_summary(graph_id: str):
    """Full structural summary (upstream shape — tests assert the nested keys)."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    try:
        graph = _load_registered_graph(graph_id)
        n = graph.number_of_nodes()
        directed = nx.is_directed(graph)
        summary = {
            "graph_id": graph_id,
            "basic_properties": {
                "number_of_nodes": n,
                "number_of_edges": graph.number_of_edges(),
                "is_directed": directed,
                "is_weakly_connected": nx.is_weakly_connected(graph) if (directed and n > 0) else None,
                "is_strongly_connected": nx.is_strongly_connected(graph) if (directed and n > 0) else None,
                "is_connected": nx.is_connected(graph) if (not directed and n > 0) else None,
            },
            "degree_properties": {
                "average_degree": sum(dict(graph.degree()).values()) / n if n > 0 else 0,
                "degree_centrality_distribution": create_degree_centrality_distribution(graph) if n > 0 else {},
            },
            "node_properties": {
                "node_count": n,
                "nodes_with_highest_degree": sorted(graph.degree(), key=lambda x: x[1], reverse=True)[:5],
            },
            "edge_properties": {
                "edge_count": graph.number_of_edges(),
                "edges_with_highest_weight": sorted(
                    graph.edges(data='weight', default=1), key=lambda x: x[2], reverse=True)[:5],
            },
            "edge_type_properties": {
                "edge_type_counts": _count_by_type(graph.edges(data=True), 2, 'Edge Type'),
            },
            "node_type_properties": {
                "node_type_counts": _count_by_type(graph.nodes(data=True), 1, 'Node Type'),
            },
        }
        return JSONResponse(content=summary)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing graph: {str(e)}")


@router.get("/node-types/{graph_id}", summary="[legacy] Get node type counts by graph ID")
def get_node_type_counts(graph_id: str):
    """`{graph_id, node_type_counts, total_nodes}`. Upstream contract."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    try:
        graph = _load_registered_graph(graph_id)
        return JSONResponse(content={
            "graph_id": graph_id,
            "node_type_counts": _count_by_type(graph.nodes(data=True), 1, 'Node Type'),
            "total_nodes": graph.number_of_nodes(),
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing graph: {str(e)}")


@router.get("/edge-types/{graph_id}", summary="[legacy] Get edge type counts by graph ID")
def get_edge_type_counts(graph_id: str):
    """`{graph_id, edge_type_counts, total_edges}`. Upstream contract."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    try:
        graph = _load_registered_graph(graph_id)
        return JSONResponse(content={
            "graph_id": graph_id,
            "edge_type_counts": _count_by_type(graph.edges(data=True), 2, 'Edge Type'),
            "total_edges": graph.number_of_edges(),
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing graph: {str(e)}")


def _count_by_type(items, data_idx, type_key):
    """Count items by `type_key`, missing → 'Unknown'. `data_idx` is the position
    of the attr dict in each tuple (1 for nodes(data=True), 2 for edges(data=True))."""
    counts = {}
    for item in items:
        t = item[data_idx].get(type_key, 'Unknown')
        counts[t] = counts.get(t, 0) + 1
    return counts
