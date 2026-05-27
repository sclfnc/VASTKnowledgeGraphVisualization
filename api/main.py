"""Telescope FastAPI backend — wiring only; domain logic lives in dedicated modules."""
import asyncio
import hashlib
import json
import logging
import os
import statistics
import uuid
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import networkit as nk

from schema import compute_schema, load_node_link, node_type, percentile
from registry import (
    Caches,
    EMPTY_CENTRALITY_STATUS,
    centrality_status,
    ego_subgraph_cache,
    graph_names,
    graph_path,
    graph_registry,
    load_graph,
    register_graph,
)
import precompute
import datasets
from centrality import centrality_response
from components import compute_components
from degree_fit import compute_degree_fit
from attribute_index import get_attribute_index
from edge_flow import compute_edge_flow
from edge_index import get_edge_index, get_edge_index_map
from effective_types import get_effective_types
from ego import ego_subgraph, EgoTooLargeError, LRU_SIZE, SOFT_CAP_DEFAULT, VALID_DIRECTIONS
from node_index import get_node_index
from node_inspect import inspect_node, list_neighbors
from edge_inspect import inspect_edge
from timeline import compute_timeline
from type_mixing import compute_type_mixing

logger = logging.getLogger("telescope.centrality")

# Reject uploads above this threshold to avoid OOM/DoS.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

app = FastAPI(
    title="Telescope Graph API",
    description="Backend for the Telescope visual analytics prototype.",
    version="1.0.0",
)

# CORS: vite picks a port in 5173–5180 range based on what's free; matching
# all of them avoids breakage when an old dev process holds the canonical port.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compress responses ≥ 1KB. /attribute-index/ on MovieLens is ~2.7MB raw and
# compresses to a few hundred KB; same for /nodes/ on MC1 (~600KB).
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.on_event("startup")
def _configure_networkit():
    """Cap NetworKit threads — defaults to all cores, starving the asyncio loop."""
    cores = os.cpu_count() or 1
    threads = min(8, max(1, cores // 2))
    nk.setNumberOfThreads(threads)
    logger.info("NetworKit thread cap: %d (host cores: %d)", threads, cores)


def cached_endpoint(cache_name: str, compute_fn):
    """Cache-then-compute for endpoints whose payload is a pure function of the graph."""
    def run(graph_id: str) -> JSONResponse:
        cache = Caches[cache_name]
        cached = cache.get(graph_id)
        if cached is not None:
            return JSONResponse(content=cached)
        try:
            G = load_graph(graph_id)
            result = compute_fn(G)
            cache[graph_id] = result
            return JSONResponse(content=result)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error computing {cache_name}: {str(e)}")
    return run


@app.post("/upload/", summary="Upload a NetworkX graph JSON file")
async def upload_graph(file: UploadFile = File(...), name: str = Form(None)):
    """Async because UploadFile.read() is async."""
    if not (file.filename or '').lower().endswith('.json'):
        raise HTTPException(status_code=400, detail="File must have .json extension")

    try:
        contents = await file.read()
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large: {len(contents)} bytes (max {MAX_UPLOAD_BYTES})",
            )

        data = json.loads(contents)

        try:
            load_node_link(data)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid NetworkX graph format: {str(e)}",
            )

        graph_id = str(uuid.uuid4())
        file_path = graph_path(graph_id)

        # Sync disk write moved to executor: blocking the event loop on multi-MB
        # uploads stalled every other request handler.
        def _write_bytes(path, data):
            with open(path, 'wb') as f:
                f.write(data)
        await asyncio.get_running_loop().run_in_executor(None, _write_bytes, file_path, contents)

        # Order: drain → register → kickoff (registering first would race with cleanup).
        await precompute.cancel_all()
        clean_name = (name or '').strip()
        register_graph(graph_id, file_path, clean_name or 'Uploaded graph')
        precompute.kickoff(graph_id)

        return JSONResponse(
            status_code=201,
            content={
                "graph_id": graph_id,
                "message": "Graph uploaded successfully",
                "filename": file.filename,
            },
        )

    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@app.get("/datasets/", summary="List available built-in datasets")
def list_datasets():
    return JSONResponse(content=datasets.list_builtin_payload())


@app.post("/datasets/load/{name}", summary="Load a built-in NetworkX dataset")
async def load_builtin_dataset(name: str):
    """Async because we await the precompute cancellation before registering.

    The built-in loader does NX construction + JSON dump synchronously; for
    large built-ins (MovieLens ~100k edges) it would stall the event loop, so
    we hand it off to the default threadpool.
    """
    await precompute.cancel_all()
    graph_id = await asyncio.get_running_loop().run_in_executor(
        None, datasets.load_builtin_payload, name,
    )
    precompute.kickoff(graph_id)
    return JSONResponse(status_code=201, content={
        "graph_id": graph_id,
        "message": f"Built-in dataset '{name}' loaded successfully",
    })


@app.get("/schema/{graph_id}", summary="Get lightweight schema for a graph")
def get_schema(graph_id: str):
    cache = Caches['schema']
    cached = cache.get(graph_id)
    if cached is not None:
        return JSONResponse(content=cached)
    graph = load_graph(graph_id)
    name = graph_names.get(graph_id) or 'Graph'
    schema = compute_schema(graph, name=name)
    cache[graph_id] = schema
    return JSONResponse(content=schema)


@app.get("/metrics/{graph_id}", summary="Degree sequence + stats for the Degree Distribution panel")
def get_metrics(graph_id: str):
    """Degree sequence + summary stats + per-type breakdown for DegreeDistribution."""
    try:
        G = load_graph(graph_id)
        degree_sequence = sorted([d for _, d in G.degree()], reverse=True)
        sorted_deg = sorted(degree_sequence)
        n = len(degree_sequence)

        q1 = percentile(sorted_deg, 25)
        q3 = percentile(sorted_deg, 75)
        iqr = q3 - q1
        degree_stats = {
            'mean': statistics.mean(degree_sequence),
            'median': statistics.median(degree_sequence),
            'min': min(degree_sequence),
            'max': max(degree_sequence),
            'std': statistics.stdev(degree_sequence) if n > 1 else 0,
            'p25': q1,
            'p75': q3,
            'iqr': iqr,
            'whisker_lo': max(min(degree_sequence), q1 - 1.5 * iqr),
            'whisker_hi': min(max(degree_sequence), q3 + 1.5 * iqr),
        }

        degree_by_type = {}
        for n_id, deg in G.degree():
            degree_by_type.setdefault(node_type(G, n_id), []).append(deg)

        return JSONResponse(content={
            'degree_sequence': degree_sequence,
            'degree_stats': degree_stats,
            'degree_by_type': degree_by_type,
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing metrics: {str(e)}")


get_degree_fit_impl = cached_endpoint('degree_fit', compute_degree_fit)

@app.get("/degree-fit/{graph_id}", summary="Fit degree distribution to theoretical models")
def get_degree_fit(graph_id: str):
    return get_degree_fit_impl(graph_id)


get_components_impl = cached_endpoint('components', compute_components)

@app.get("/components/{graph_id}", summary="Connected components breakdown")
def get_components(graph_id: str):
    return get_components_impl(graph_id)


get_edge_flow_impl = cached_endpoint('edge_flow', compute_edge_flow)

@app.get("/edge-flow/{graph_id}", summary="Tripartite edge-type flow (meta-graph payload)")
def get_edge_flow(graph_id: str):
    return get_edge_flow_impl(graph_id)


get_type_mixing_impl = cached_endpoint('type_mixing', compute_type_mixing)

@app.get("/type-mixing/{graph_id}", summary="Type mixing matrix (edges and nodes modes)")
def get_type_mixing(graph_id: str):
    return get_type_mixing_impl(graph_id)


def _overrides_key(overrides_json: Optional[str]) -> str:
    if not overrides_json:
        return ''
    try:
        parsed = json.loads(overrides_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="overrides must be valid JSON")
    try:
        canonical = json.dumps(parsed, sort_keys=True)
    except TypeError as e:
        raise HTTPException(status_code=400, detail=f"overrides contains non-JSON-serializable values: {e}")
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


@app.get("/timeline/{graph_id}", summary="Temporal activity histogram per attribute")
def get_timeline(graph_id: str, overrides: Optional[str] = None):
    key = _overrides_key(overrides)
    sub = Caches['timeline'].setdefault(graph_id, {})
    if key in sub:
        return JSONResponse(content=sub[key])
    try:
        G = load_graph(graph_id)
        parsed_overrides = json.loads(overrides) if overrides else None
        result = compute_timeline(G, overrides=parsed_overrides)
        sub[key] = result
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing timeline: {str(e)}")


@app.get("/centrality/spectral/{graph_id}", summary="PageRank + Eigenvector")
def get_spectral(graph_id: str):
    return centrality_response(graph_id, 'spectral')


@app.get("/centrality/betweenness/{graph_id}", summary="Betweenness centrality")
def get_betweenness(graph_id: str):
    return centrality_response(graph_id, 'betweenness')


@app.get("/centrality/closeness/{graph_id}", summary="Closeness centrality")
def get_closeness(graph_id: str):
    return centrality_response(graph_id, 'closeness')


@app.get("/centrality-status/{graph_id}", summary="Per-measure status for sidebar polling")
def get_centrality_status(graph_id: str):
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    return JSONResponse(content=centrality_status.get(graph_id) or dict(EMPTY_CENTRALITY_STATUS))


@app.get("/nodes/{graph_id}", summary="Full node index (id, type, degree)")
def get_nodes(graph_id: str):
    """Full node index, degree-sorted desc. ~600KB on MC1; powers client-side search."""
    try:
        return JSONResponse(content=get_node_index(graph_id))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing node index: {str(e)}")


@app.get("/edges/{graph_id}", summary="Full edge index (SoA: source, target, type, weight)")
def get_edges(graph_id: str):
    """SoA edge index in G.edges canonical order; i-th record has edge_id = i."""
    try:
        return JSONResponse(content=get_edge_index(graph_id))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing edge index: {str(e)}")


@app.get("/attribute-index/{graph_id}",
         summary="Per-(type, attribute) precomputed index for v2 filter pipeline")
def get_attribute_index_endpoint(graph_id: str):
    """{node_attrs, edge_attrs} keyed by type, then attr; powers per-type attr filters."""
    try:
        return JSONResponse(content=get_attribute_index(graph_id))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing attribute index: {str(e)}")


@app.get("/effective-types/{graph_id}",
         summary="Effective type labels per node/edge (auto- or user-promoted attr)")
def get_effective_types_endpoint(graph_id: str,
                                 node_attr: Optional[str] = None,
                                 edge_attr: Optional[str] = None):
    """`{node: [labels|null], edge: [labels|null], promoted: {...}}`. Empty
    query params = use schema.auto_promoted. Phase 7+ will accept manual
    overrides via the same params."""
    try:
        return JSONResponse(content=get_effective_types(graph_id, node_attr, edge_attr))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing effective types: {str(e)}")


@app.get("/ego/{graph_id}/{node_id}", summary="k-hop ego subgraph around a node")
def get_ego(graph_id: str, node_id: str, k: int = 1, cap: int = SOFT_CAP_DEFAULT,
            direction: str = 'out'):
    """BFS depth k (clamped 1..3), stratified-sample over cap; 422 when too large."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    if direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=400,
                            detail=f"Invalid direction '{direction}'. Must be one of {VALID_DIRECTIONS}.")
    k_clamped = max(1, min(3, k))
    cap_clamped = max(50, min(1000, cap))
    cache_key = (graph_id, node_id, k_clamped, cap_clamped, direction)

    cached = ego_subgraph_cache.get(cache_key)
    if cached is not None:
        ego_subgraph_cache.move_to_end(cache_key)
        return JSONResponse(content=cached)

    try:
        G = load_graph(graph_id)
        edge_map = get_edge_index_map(graph_id)
        result = ego_subgraph(G, node_id, k_clamped, cap_clamped, direction, edge_index_map=edge_map)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not in graph")
    except EgoTooLargeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing ego subgraph: {str(e)}")

    ego_subgraph_cache[cache_key] = result
    if len(ego_subgraph_cache) > LRU_SIZE:
        ego_subgraph_cache.popitem(last=False)
    return JSONResponse(content=result)


@app.get("/node-inspect/{graph_id}/{node_id}", summary="Per-node inspector payload")
def get_node_inspect(graph_id: str, node_id: str):
    """Compact JSON envelope for the NodeInspector panel: identity + attributes
    + structural counters + small neighbor sample. Not cached — sync compute is
    O(degree), and these requests follow user clicks, not bulk operations."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    try:
        G = load_graph(graph_id)
        edge_map = get_edge_index_map(graph_id)
        return JSONResponse(content=inspect_node(G, node_id, edge_index_map=edge_map))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not in graph")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error inspecting node: {str(e)}")


@app.get("/node-neighbors/{graph_id}/{node_id}", summary="Paginated neighbor list for the inspector")
def get_node_neighbors(graph_id: str, node_id: str, offset: int = 0, limit: int = 50,
                       direction: str = 'all'):
    """Paginated companion to /node-inspect/. Sorted by degree desc; supports
    direction filter ('all' | 'in' | 'out') for directed graphs."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    if direction not in ('all', 'in', 'out'):
        raise HTTPException(status_code=400,
                            detail=f"Invalid direction '{direction}'. Must be 'all', 'in', or 'out'.")
    try:
        G = load_graph(graph_id)
        edge_map = get_edge_index_map(graph_id)
        return JSONResponse(content=list_neighbors(
            G, node_id, edge_map, direction=direction, offset=offset, limit=limit))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not in graph")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing neighbors: {str(e)}")


@app.get("/edge-inspect/{graph_id}/{edge_id}", summary="Per-edge inspector payload")
def get_edge_inspect(graph_id: str, edge_id: int):
    """Resolve edge_id (canonical /edges/ index) into source/target + raw attrs."""
    if graph_id not in graph_registry:
        raise HTTPException(status_code=404, detail="Graph ID not found")
    try:
        G = load_graph(graph_id)
        return JSONResponse(content=inspect_edge(graph_id, G, edge_id))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Edge id {edge_id} out of range")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error inspecting edge: {str(e)}")


@app.get("/health/", summary="Health check")
def health():
    return {"status": "ok"}
