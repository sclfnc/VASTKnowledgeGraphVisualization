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


@app.get("/metrics/{graph_id}", summary="Get computed metrics for D3 panels")
def get_metrics(graph_id: str):
    """
    Compute and return metrics needed by D3 wiki panels.
    Results are NOT cached (may be expensive for large graphs).
    """
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")

    try:
        with open(graph_registry[graph_id]) as f:
            G = nx.node_link_graph(json.load(f))

        # Degree sequence
        degree_sequence = sorted([d for _, d in G.degree()], reverse=True)

        # Degree statistics
        import statistics
        degree_stats = {
            'mean': statistics.mean(degree_sequence),
            'median': statistics.median(degree_sequence),
            'min': min(degree_sequence),
            'max': max(degree_sequence),
            'std': statistics.stdev(degree_sequence) if len(degree_sequence) > 1 else 0,
        }

        # ER baseline (same N, E)
        N = G.number_of_nodes()
        E = G.number_of_edges()
        p = 2 * E / (N * (N - 1)) if N > 1 else 0
        G_er = nx.erdos_renyi_graph(N, p, seed=42)
        er_baseline = sorted([d for _, d in G_er.degree()], reverse=True)

        # Connectivity
        if G.is_directed():
            wcc = nx.number_weakly_connected_components(G)
            lcc_nodes = max(nx.weakly_connected_components(G), key=len) if wcc > 0 else set()
        else:
            wcc = nx.number_connected_components(G)
            lcc_nodes = max(nx.connected_components(G), key=len) if wcc > 0 else set()

        # LCC subgraph
        if lcc_nodes:
            G_lcc = G.subgraph(lcc_nodes).copy()
            if G_lcc.number_of_nodes() > 0:
                diameter = nx.diameter(G_lcc.to_undirected() if G.is_directed() else G_lcc)
                lengths = dict(nx.all_pairs_shortest_path_length(G_lcc))
                avg_path = sum(sum(dict(lengths[u]).values()) for u in lengths) / (G_lcc.number_of_nodes() * (G_lcc.number_of_nodes() - 1)) if G_lcc.number_of_nodes() > 1 else 0
            else:
                diameter = 0
                avg_path = 0
        else:
            diameter = 0
            avg_path = 0

        # Density
        if G.number_of_nodes() > 1:
            density = nx.density(G)
        else:
            density = 0

        # Clustering coefficient
        try:
            global_clustering = nx.transitivity(G)
        except:
            global_clustering = 0

        # Reciprocity (directed only)
        if G.is_directed():
            try:
                reciprocity = nx.reciprocity(G)
            except:
                reciprocity = 0
        else:
            reciprocity = None

        # Assortativity
        try:
            assortativity = nx.degree_assortativity_coefficient(G)
        except:
            assortativity = 0

        return JSONResponse(content={
            'degree_sequence': degree_sequence,
            'degree_stats': degree_stats,
            'er_baseline': er_baseline,
            'weakly_connected_components': wcc,
            'lcc_size': len(lcc_nodes),
            'diameter': diameter,
            'avg_shortest_path': avg_path,
            'density': float(density),
            'global_clustering': float(global_clustering),
            'reciprocity': reciprocity,
            'assortativity': float(assortativity),
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing metrics: {str(e)}")


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