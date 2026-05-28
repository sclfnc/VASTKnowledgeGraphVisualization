# Telescope — Backend

FastAPI server: loads a graph, computes graph-analysis payloads per panel, serves them as JSON.
NetworkX for graph ops, NetworKit for centralities (pure NetworkX is too slow at MC1 scale),
`powerlaw` for degree-distribution fits. **Read-only and stateless across restarts** — the registry
is in-memory, so restarting the server clears every loaded graph.

## Setup

```bash
cd api
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`--reload` reloads code on edit but **not** the in-memory caches — to see a recomputed payload on an
already-loaded graph (e.g. after changing a compute function), reload the dataset from the frontend.

## Module layout

`main.py` is **wiring only** (each endpoint is a few lines that delegate). Domain logic lives one
module per feature; `schema.py` is the shared hub.

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app, middleware (GZip), endpoint wiring, `cached_endpoint` helper |
| `registry.py` | in-memory graph registry + `Caches` dict + `load_graph` + `invalidate_caches` |
| `schema.py` | `compute_schema`, auto-promotion, **single source of truth** for type lookups (`node_type`, `edge_type`), JSON coercion (`json_scalar`), `percentile`, reserved-attr constants |
| `datasets.py` | built-in dataset loaders + eager structural summary |
| `node_index.py` / `edge_index.py` | SoA payloads + the canonical degree-desc node order + `(u,v[,key]) → edge_id` map |
| `degree_fit.py` | power-law / exponential / Poisson / log-normal fits (CSN framework) |
| `components.py` | WCC / SCC breakdown |
| `centrality.py` | NetworKit wrappers + `centrality_response(graph_id, measure)` dispatcher |
| `precompute.py` | async centrality pipeline (`kickoff` / `cancel_all`) |
| `type_mixing.py` | mixing-matrix metadata + Newman assortativity |
| `edge_flow.py` | flow metadata (type lists, counts) |
| `timeline.py` | per-attribute temporal binning (configurable parse strategy) + per-bin SoA indices |
| `attribute_index.py` | v2 per-(type, attr) filter buckets (categorical / numeric / boolean / temporal / text) |
| `effective_types.py` | per-item effective type labels (auto-promotion) |
| `ego.py` | k-hop ego subgraph (BFS, cap + timeout guarded) |
| `inspectors.py` | per-node + per-edge inspector payloads (unified — named `inspectors`, not `inspect`, to avoid shadowing the stdlib module) |

## Endpoints (23)

```
POST /upload/                              register an uploaded NetworkX JSON (≤ 50 MB) → graph_id
GET  /datasets/                            built-in list + structural summary
POST /datasets/load/{name}                 load a built-in → graph_id
GET  /schema/{id}                          counts, types, ranges, structural flags, auto_promoted
GET  /metrics/{id}                         degree sequence + stats + degree_by_type
GET  /degree-fit/{id}                      theoretical fits + by-type
GET  /components/{id}                       WCC (+ SCC if directed) breakdown
GET  /type-mixing/{id}                     assortativity + metadata (counts client-side)
GET  /edge-flow/{id}                       flow metadata (flows client-side)
GET  /timeline/{id}                        per-attribute temporal bins + per-bin idx
GET  /nodes/{id}                           SoA node index (degree-desc)
GET  /edges/{id}                           SoA edge index (edge_id = walk index)
GET  /attribute-index/{id}                 per-(type, attr) filter buckets
GET  /effective-types/{id}                 per-item effective type labels
GET  /centrality/spectral/{id}             PageRank (full) + Eigenvector (LCC)
GET  /centrality/betweenness/{id}          exact Brandes (parallel)
GET  /centrality/closeness/{id}            per-component Wasserman-Faust
GET  /centrality-status/{id}               per-measure poll status
GET  /ego/{id}/{node}                       k-hop subgraph (cap/timeout guarded)
GET  /node-inspect/{id}/{node}             inspector envelope + neighbor preview
GET  /node-neighbors/{id}/{node}           paginated neighbor list
GET  /edge-inspect/{id}/{edge}             per-edge inspector payload
GET  /health/                              health check
```

Per-graph results are cached in `registry.Caches` (`schema`, `degree_fit`, `components`,
`node_index`, `node_order`, `edge_index`, `edge_index_map`, `graph_object`, `edge_flow`,
`type_mixing`, `timeline`, `attribute_index`, `effective_types`) plus specialized caches alongside it
(centrality status/data, ego LRU). `invalidate_caches(graph_id)` clears all of them on (re)register.

## Conventions

- **`main.py` = wiring.** New endpoints follow the `cached_endpoint(cache_name, compute_fn)` pattern
  when the payload is a pure function of the graph; otherwise stay thin and delegate.
- **Type lookups single-sourced in `schema.py`.** Use `node_type(G, n)` / `edge_type(data)`, never
  inline `.get('Node Type'/'Edge Type', 'Unknown')`. JSON coercion goes through `json_scalar`.
- **`async def` only with a real `await`.** Sync I/O in a `def` handler runs in FastAPI's threadpool
  and doesn't block the loop; an `async def` with sync I/O blocks every request for its duration.
- **Exception order:** `except HTTPException: raise` before `except Exception`, so validation 4xx
  aren't masked as 500s.
- **Mask-only contract:** the backend is stateless w.r.t. filters. It never receives or applies a
  filter — it ships full-graph payloads (plus SoA indices), and the frontend masks client-side.
  `type_mixing` / `edge_flow` ship metadata only; their counts are recomputed in the browser.
- **GZip middleware** compresses payloads ≥ 1 KB (the SoA / index payloads shrink ~70–80%).

## Centrality pipeline

On `/upload/` and `/datasets/load/`, the server cancels any running precompute (awaits each task
before draining its registry), wipes caches, then kicks off **spectral → betweenness → closeness**
(fastest first), each in the default threadpool so the event loop stays responsive. The three
`/centrality/...` data endpoints return `200 {data}` when ready, `202 {status}` in-flight, `410`
cancelled, `500` on error, `404` for unknown id. The frontend polls `/centrality-status/` only.
