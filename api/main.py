"""
FastAPI application for handling NetworkX graphs.

This application provides endpoints for:
- Uploading JSON files containing NetworkX graphs
- Retrieving graph summaries by unique ID
- Setting a default graph that can be accessed without uploading a file
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import networkx as nx
import json
import os
import uuid
from typing import Dict, Any
from pathlib import Path

# EXTENSION: lightweight schema extractor — single source of truth for /schema endpoint
TEMPORAL_HINTS = ('date', 'year', 'time', 'timestamp')

RESERVED_NODE_ATTRS = {'Node Type'}

def _infer_attr_kind(values):
    sample = [v for v in values if v is not None]
    if not sample:
        return None
    if all(isinstance(v, bool) for v in sample):
        return 'boolean'
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in sample):
        return 'numeric'
    return 'categorical'


def compute_schema(G, name='Graph'):
    nodes_data = list(G.nodes(data=True))
    edge_data  = [d for _, _, d in G.edges(data=True)]

    node_attrs = {k for _, d in nodes_data for k in d}
    node_types = sorted({d.get('Node Type', 'Unknown') for _, d in nodes_data})
    edge_types = sorted({d.get('Edge Type', 'Unknown') for d in edge_data})

    # weighted only if at least one edge has a non-trivial weight (more than one distinct value)
    weights = [d['weight'] for d in edge_data if 'weight' in d]
    distinct_weights = set(weights)
    weighted = len(distinct_weights) > 1
    weight_range = [min(weights), max(weights)] if weighted else None

    temporal_attrs = sorted({a for a in node_attrs if any(h in a.lower() for h in TEMPORAL_HINTS)})

    # degree range — uses total degree; frontend can split in/out for directed graphs if needed
    degrees = [d for _, d in G.degree()]
    degree_range = [min(degrees), max(degrees)] if degrees else [0, 0]

    # per-attribute kind inference, used to render dynamic filters
    attributes = []
    for attr in sorted(node_attrs - RESERVED_NODE_ATTRS):
        values = [d[attr] for _, d in nodes_data if attr in d]
        kind = _infer_attr_kind(values)
        if kind is None:
            continue
        entry = {'name': attr, 'kind': kind}
        if kind == 'numeric':
            nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
            if nums:
                entry['range'] = [min(nums), max(nums)]
        elif kind == 'categorical':
            cats = sorted({str(v) for v in values})
            # cap categorical filter values to keep payload small
            if len(cats) <= 50:
                entry['values'] = cats
            else:
                entry['values'] = cats[:50]
                entry['truncated'] = True
        attributes.append(entry)

    self_loops = nx.number_of_selfloops(G)
    acyclic = nx.is_directed_acyclic_graph(G) if G.is_directed() else None
    try:
        bipartite = nx.is_bipartite(G)
    except nx.NetworkXError:
        bipartite = False

    return {
        'name': name,
        'nodes': G.number_of_nodes(),
        'edges': G.number_of_edges(),
        'directed': G.is_directed(),
        'multigraph': G.is_multigraph(),
        'weighted': weighted,
        'bipartite': bipartite,
        'node_types': node_types,
        'edge_types': edge_types,
        'temporal_attrs': temporal_attrs,
        'self_loops': self_loops,
        'acyclic': acyclic,
        'degree_range': degree_range,
        'weight_range': weight_range,
        'attributes': attributes,
        'warnings': [],
    }


# EXTENSION: built-in dataset registry — maps name to (loader_fn, description)
BUILTIN_DATASETS = {
    "karate":       (nx.karate_club_graph,        "Zachary's Karate Club — 34 nodes, 78 edges"),
    "les_miserables": (nx.les_miserables_graph,   "Les Misérables characters — 77 nodes, 254 edges"),
    "florentine":   (nx.florentine_families_graph, "Florentine families — 15 nodes"),
    "davis":        (nx.davis_southern_women_graph,"Davis Southern Women — bipartite"),
}

# Normalize built-in datasets to expose 'Node Type' / 'Edge Type' attributes,
# matching the convention used by MC1 so compute_schema works uniformly.
# 'from': read value from this node attribute (optionally remapped via 'map')
# 'const': assign a fixed string to every node
BUILTIN_TYPE_NORMALIZATION = {
    "karate":         {'node': {'from': 'club'},
                       'edge': {'const': 'Friendship'}},
    "les_miserables": {'node': {'const': 'Character'},
                       'edge': {'const': 'CoAppearance'}},
    "florentine":     {'node': {'const': 'Family'},
                       'edge': {'const': 'Marriage'}},
    "davis":          {'node': {'from': 'bipartite', 'map': {0: 'Woman', 1: 'Event'}},
                       'edge': {'const': 'Attended'}},
}


def normalize_builtin_types(name, G):
    spec = BUILTIN_TYPE_NORMALIZATION.get(name)
    if not spec:
        return
    nspec = spec.get('node')
    if nspec:
        for _, d in G.nodes(data=True):
            if 'const' in nspec:
                d['Node Type'] = nspec['const']
            else:
                v = d.get(nspec['from'])
                d['Node Type'] = nspec.get('map', {}).get(v, str(v))
    espec = spec.get('edge')
    if espec:
        for *_, d in G.edges(data=True):
            if 'const' in espec:
                d['Edge Type'] = espec['const']
            else:
                v = d.get(espec['from'])
                d['Edge Type'] = espec.get('map', {}).get(v, str(v))

app = FastAPI(
    title="NetworkX Graph API",
    description="API for uploading and analyzing NetworkX graphs",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:5173", "http://127.0.0.1", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directory to store uploaded graph files
GRAPH_STORAGE_DIR = "graph_storage"

# Create storage directory if it doesn't exist
Path(GRAPH_STORAGE_DIR).mkdir(exist_ok=True)

# Dictionary to map graph IDs to file paths
# In production, this would be a database
graph_registry: Dict[str, str] = {}

# In-memory cache for /schema/ responses, invalidated when a graph is (re)registered.
# compute_schema is non-trivial on large graphs (MC1: ~37k edges) and the schema
# does not change for a given graph_id.
schema_cache: Dict[str, Any] = {}

# Upload size limit: reject files above this threshold to avoid OOM/DoS.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

# Default graph ID - special constant to access the default graph
default_graph_id = "default"


def create_degree_centrality_distribution(graph):
    """
    Create a distribution of degree centrality values instead of per-node values.
    This is more compact and suitable for large graphs.
    Uses adaptive binning based on actual degree centrality values.

    Returns:
        A dictionary with bins of degree centrality values and their counts.
    """
    degree_centrality_values = list(nx.degree_centrality(graph).values())

    if not degree_centrality_values:
        return {
            "stats": {
                "min": 0,
                "max": 0,
                "mean": 0,
                "median": 0,
                "total_nodes": 0
            }
        }

    # Get min and max values
    min_val = min(degree_centrality_values)
    max_val = max(degree_centrality_values)

    # Use adaptive binning based on actual values
    # Create 10 bins that cover the actual range of values
    if min_val == max_val:
        # All values are the same, just use one bin
        bins = [min_val, min_val]
    else:
        # Create 10 evenly spaced bins covering the actual range
        bins = [min_val + i * (max_val - min_val) / 10 for i in range(11)]

    distribution = {}

    for i in range(len(bins) - 1):
        lower = bins[i]
        upper = bins[i + 1]
        bin_key = f"{lower:.4f}-{upper:.4f}"
        count = sum(1 for value in degree_centrality_values if lower <= value < upper)
        distribution[bin_key] = count

    # Add statistics about the distribution
    distribution["stats"] = {
        "min": min_val,
        "max": max_val,
        "mean": sum(degree_centrality_values) / len(degree_centrality_values),
        "median": sorted(degree_centrality_values)[len(degree_centrality_values) // 2],
        "total_nodes": len(degree_centrality_values)
    }

    return distribution


@app.post("/upload/", summary="Upload a NetworkX graph JSON file")
async def upload_graph(file: UploadFile = File(...)):  # async kept: UploadFile.read() is async
    """
    Upload a JSON file containing a NetworkX graph.

    The file should contain a NetworkX graph in JSON format (e.g., from nx.readwrite.json_graph.node_link_data).

    Returns:
        A unique ID that can be used to reference this graph in other endpoints.
    """
    # Check if file has .json extension
    if not file.filename.lower().endswith('.json'):
        raise HTTPException(status_code=400, detail="File must have .json extension")

    try:
        # Read the file content
        contents = await file.read()
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large: {len(contents)} bytes (max {MAX_UPLOAD_BYTES})"
            )

        data = json.loads(contents)

        # Validate that it's a NetworkX graph by trying to load it
        try:
            nx.node_link_graph(data)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid NetworkX graph format: {str(e)}"
            )

        # Generate a unique ID for this graph
        graph_id = str(uuid.uuid4())

        # Save the raw bytes — already validated, no need to re-serialize
        file_path = os.path.join(GRAPH_STORAGE_DIR, f"{graph_id}.json")
        with open(file_path, 'wb') as f:
            f.write(contents)

        # Register the graph and invalidate any stale schema cache for this id
        graph_registry[graph_id] = file_path
        schema_cache.pop(graph_id, None)

        return JSONResponse(
            status_code=201,
            content={
                "graph_id": graph_id,
                "message": "Graph uploaded successfully",
                "filename": file.filename
            }
        )

    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@app.post("/set-default/{graph_id}", summary="Set a graph as the default graph")
def set_default_graph(graph_id: str):
    """
    Set a graph as the default graph that can be accessed without uploading a file.

    Args:
        graph_id: The unique ID of the graph to set as default, or the filename in graph_storage (without .json extension).

    Returns:
        Confirmation that the graph is now the default.
    """
    # Check if graph ID exists in registry
    if graph_id in graph_registry:
        # Graph ID found in registry, use it
        file_path = graph_registry[graph_id]
    else:
        # Graph ID not in registry, check if it's a file in graph_storage
        # Try with .json extension first
        file_path = os.path.join(GRAPH_STORAGE_DIR, f"{graph_id}.json")
        if not os.path.exists(file_path):
            # Also try without extension (for backward compatibility)
            file_path = os.path.join(GRAPH_STORAGE_DIR, graph_id)
            if not os.path.exists(file_path):
                raise HTTPException(status_code=404, detail="Graph ID not found in registry or storage")

        # Add to registry for future reference
        graph_registry[graph_id] = file_path

    # Set this graph as the default
    graph_registry[default_graph_id] = file_path

    return JSONResponse(
        status_code=200,
        content={
            "message": "Graph set as default successfully",
            "default_graph_id": default_graph_id,
            "graph_id": graph_id
        }
    )


@app.get("/summary/{graph_id}", summary="Get graph summary by ID")
def get_graph_summary(graph_id: str):
    """
    Get a summary of the properties of a NetworkX graph.

    Args:
        graph_id: The unique ID returned when uploading the graph, or "default" to access the default graph.

    Returns:
        A JSON object containing various properties of the graph.
    """
    # Check if graph ID exists in registry
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")

    try:
        # Load the graph from file
        file_path = graph_registry[graph_id]
        with open(file_path, 'r') as f:
            data = json.load(f)

        # Load as NetworkX graph
        graph = nx.node_link_graph(data)

        # Calculate graph properties
        summary = {
            "graph_id": graph_id,
            "basic_properties": {
                "number_of_nodes": graph.number_of_nodes(),
                "number_of_edges": graph.number_of_edges(),
                "is_directed": nx.is_directed(graph),
                "is_weakly_connected": nx.is_weakly_connected(graph) if (nx.is_directed(graph) and graph.number_of_nodes() > 0) else None,
                "is_strongly_connected": nx.is_strongly_connected(graph) if (nx.is_directed(graph) and graph.number_of_nodes() > 0) else None,
                "is_connected": nx.is_connected(graph) if (not nx.is_directed(graph) and graph.number_of_nodes() > 0) else None,
            },
            "degree_properties": {
                "average_degree": sum(dict(graph.degree()).values()) / graph.number_of_nodes() if graph.number_of_nodes() > 0 else 0,
                "degree_centrality_distribution": create_degree_centrality_distribution(graph) if graph.number_of_nodes() > 0 else {},
            },
            "node_properties": {
                "node_count": graph.number_of_nodes(),
                "nodes_with_highest_degree": sorted(
                    graph.degree(),
                    key=lambda x: x[1],
                    reverse=True
                )[:5]  # Top 5 nodes by degree
            },
            "edge_properties": {
                "edge_count": graph.number_of_edges(),
                "edges_with_highest_weight": sorted(
                    graph.edges(data='weight', default=1),
                    key=lambda x: x[2],
                    reverse=True
                )[:5]  # Top 5 edges by weight (if weighted)
            },
            "edge_type_properties": {
                "edge_type_counts": {
                    edge_type: sum(1 for edge in graph.edges(data=True) if 'Edge Type' in edge[2] and edge[2]['Edge Type'] == edge_type)
                    for edge_type in set(edge[2].get('Edge Type', 'Unknown') for edge in graph.edges(data=True))
                }
            },
            "node_type_properties": {
                "node_type_counts": {
                    node_type: sum(1 for node in graph.nodes(data=True) if 'Node Type' in node[1] and node[1]['Node Type'] == node_type)
                    for node_type in set(node[1].get('Node Type', 'Unknown') for node in graph.nodes(data=True))
                }
            }
        }

        return JSONResponse(content=summary)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing graph: {str(e)}")


@app.get("/node-types/{graph_id}", summary="Get node type counts by graph ID")
def get_node_type_counts(graph_id: str):
    """
    Get the count of nodes for each type in a NetworkX graph.

    Args:
        graph_id: The unique ID returned when uploading the graph, or "default" to access the default graph.

    Returns:
        A JSON object containing the count of nodes for each type.
    """
    # Check if graph ID exists in registry
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")

    try:
        # Load the graph from file
        file_path = graph_registry[graph_id]
        with open(file_path, 'r') as f:
            data = json.load(f)

        # Load as NetworkX graph
        graph = nx.node_link_graph(data)

        # Count nodes by type
        node_type_counts = {}

        for node in graph.nodes(data=True):
            node_data = node[1]
            if 'Node Type' in node_data:
                node_type = node_data['Node Type']
                node_type_counts[node_type] = node_type_counts.get(node_type, 0) + 1
            else:
                node_type_counts['Unknown'] = node_type_counts.get('Unknown', 0) + 1

        return JSONResponse(content={
            "graph_id": graph_id,
            "node_type_counts": node_type_counts,
            "total_nodes": graph.number_of_nodes()
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing graph: {str(e)}")


@app.get("/edge-types/{graph_id}", summary="Get edge type counts by graph ID")
def get_edge_type_counts(graph_id: str):
    """
    Get the count of edges for each type in a NetworkX graph.

    Args:
        graph_id: The unique ID returned when uploading the graph, or "default" to access the default graph.

    Returns:
        A JSON object containing the count of edges for each type.
    """
    # Check if graph ID exists in registry
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")

    try:
        # Load the graph from file
        file_path = graph_registry[graph_id]
        with open(file_path, 'r') as f:
            data = json.load(f)

        # Load as NetworkX graph
        graph = nx.node_link_graph(data)

        # Count edges by type
        edge_type_counts = {}

        for edge in graph.edges(data=True):
            edge_data = edge[2]
            if 'Edge Type' in edge_data:
                edge_type = edge_data['Edge Type']
                edge_type_counts[edge_type] = edge_type_counts.get(edge_type, 0) + 1
            else:
                edge_type_counts['Unknown'] = edge_type_counts.get('Unknown', 0) + 1

        return JSONResponse(content={
            "graph_id": graph_id,
            "edge_type_counts": edge_type_counts,
            "total_edges": graph.number_of_edges()
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing graph: {str(e)}")


# EXTENSION: list available built-in datasets — frontend uses this to populate the onboarding picker
@app.get("/datasets/", summary="List available built-in datasets")
def list_datasets():
    return JSONResponse(content={
        "datasets": [
            {"name": name, "description": desc}
            for name, (_, desc) in BUILTIN_DATASETS.items()
        ]
    })


# EXTENSION: load a built-in dataset by name, register it, and return a graph_id
@app.post("/datasets/load/{name}", summary="Load a built-in NetworkX dataset")
def load_builtin_dataset(name: str):
    if name not in BUILTIN_DATASETS:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{name}'. Available: {list(BUILTIN_DATASETS)}")

    loader_fn, _ = BUILTIN_DATASETS[name]
    graph = loader_fn()
    normalize_builtin_types(name, graph)

    graph_id = f"builtin_{name}"
    file_path = os.path.join(GRAPH_STORAGE_DIR, f"{graph_id}.json")

    data = nx.node_link_data(graph)
    with open(file_path, "w") as f:
        json.dump(data, f)

    graph_registry[graph_id] = file_path
    schema_cache.pop(graph_id, None)

    return JSONResponse(status_code=201, content={
        "graph_id": graph_id,
        "message": f"Built-in dataset '{name}' loaded successfully",
    })


# EXTENSION: schema endpoint — lightweight summary used by the dashboard Overview panel.
# Result is cached per graph_id; cache is invalidated when a graph is (re)registered.
@app.get("/schema/{graph_id}", summary="Get lightweight schema for a graph")
def get_schema(graph_id: str):
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")

    cached = schema_cache.get(graph_id)
    if cached is not None:
        return JSONResponse(content=cached)

    with open(graph_registry[graph_id]) as f:
        graph = nx.node_link_graph(json.load(f))

    name = graph_id.replace('builtin_', '').replace('_', ' ').title() if graph_id.startswith('builtin_') else graph_id
    schema = compute_schema(graph, name=name)
    schema_cache[graph_id] = schema
    return JSONResponse(content=schema)


@app.get("/health/", summary="Health check")
async def health_check():
    return JSONResponse(
        content={
            "status": "healthy",
            "graph_count": len(graph_registry)
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)