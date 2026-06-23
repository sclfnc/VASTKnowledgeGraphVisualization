# Telescope — Backend

FastAPI server: it loads a graph, computes analysis payloads per panel, and serves
them as JSON. NetworkX handles graph operations, NetworKit the centralities,
`powerlaw` the degree-distribution fits. The backend is **read-only and in-memory**: a
restart clears every loaded graph. The Vue frontend is the only client.

## Setup

```bash
cd api
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`--reload` reloads the code but **not** the in-memory caches: to see a recomputed
payload, reload the dataset from the frontend.

Four built-ins (karate, les_misérables, florentine, davis) are generated in-process.
The two larger ones — **email-eu-core** (SNAP, BSD) and **MovieLens** (GroupLens,
CC BY 4.0) — are downloaded on first load and cached in
`graph_storage/builtin_data/`; their first load needs network access, and a failed
download returns a `503` for that dataset.

**Single worker only.** All state lives in process memory (registry, caches,
centrality tasks). Never run with `--workers N > 1`: each worker would keep its own
registry, so a graph loaded by one would be invisible to the others.

## Design model (read this first)

The backend never sees a filter. It ships the *whole* graph plus the indices the
client needs to slice it fast; the browser does all filtering and selection locally.

- **Full-graph payloads.** `/nodes/`, `/edges/`, `/attribute-index/`, `/timeline/`
  return every node and edge. There is no `?filter=` query param anywhere.
- **Stable indices are the contract.** Nodes ship in degree-desc order (`node_idx`),
  edges in walk order (`edge_id`). Every payload refers to nodes/edges by these
  indices; the client masks them with bitsets, so a filter "dims" marks without the
  backend recomputing anything.
- **Metrics are computed once, on the full graph.** Never recomputed under a filter.
- **Two exceptions, on purpose.** `/type-mixing/` and `/edge-flow/` ship metadata
  only; their counts are recomputed in the browser from the edge SoA so edge filters
  reach them.
- **Effective types.** When a single-type graph has one discriminator attribute
  (Karate's `club`), `/schema/` marks it `auto_promoted` and `/effective-types/`
  ships per-item labels so the client can group and colour by it.

## Module layout

Flat files, grouped by role. `main.py` is **wiring only**: each endpoint hands off to
a feature module. Feature modules own one concern each and depend only on the core
layer.

- **Core** — `main.py` (app, middleware, wiring, `cached_endpoint`); `registry.py`
  (graph registry, `Caches`, `invalidate_caches`); `schema.py` (schema computation,
  auto-promotion, the **single source** for type lookups `node_type`/`edge_type`,
  `json_scalar`, built-in loaders).
- **Indices** — `node_index.py` (SoA nodes, source of `node_idx`); `edge_index.py`
  (SoA edges, source of `edge_id`); `attribute_index.py` (per-(type, attr) filter
  buckets); `effective_types.py` (per-item effective labels).
- **Analysis, one panel each** — `degree_fit.py`, `components.py`, `centrality.py`,
  `type_mixing.py`, `edge_flow.py`, `timeline.py`, `ego.py`, `inspectors.py`.
- **Lifecycle / data** — `datasets.py` (built-in list + summaries),
  `builtin_download.py` (external built-ins), `precompute.py` (async centrality
  pipeline).
- **Compatibility** — `legacy_compat.py`: the four upstream endpoints, copied
  unchanged so the upstream `tests/` suite passes. The modular layer never depends on
  it.

```
                         main.py            (wires every feature module)
                            │
   ┌──────────┬─────────────┼──────────────┬───────────────┐
 analysis   indices     datasets        precompute      inspectors
   │           │            │               │               │
   └───────────┴──── registry.py ───────────┘          edge_index.py
                            │
                        schema.py            (no local imports — the leaf)
```

| …change | …go to |
|---|---|
| how a type is read (`Node Type` / `Edge Type`) | `schema.py` (`node_type` / `edge_type`) |
| add a built-in dataset | `schema.py` `BUILTIN_DATASETS` + a loader fn |
| the canonical node / edge ordering | `node_index.py` / `edge_index.py` |
| how a filter attribute is indexed | `attribute_index.py` |
| a centrality measure or its scheduling | `centrality.py` / `precompute.py` |
| add a new endpoint | `main.py` (wire) + a new feature module (compute) |
| cache behaviour / invalidation | `registry.py` (`Caches`, `invalidate_caches`) |

## Endpoints

Two contracts share one app: the **legacy** upstream endpoints (kept unchanged) and
the **modular** endpoints that feed the dashboard. `/upload/` and `/health/` satisfy
both.

**Legacy (upstream contract):**
```
GET  /summary/{id}                         full structural summary (upstream nested shape)
GET  /node-types/{id}                      {node_type_counts, total_nodes}
GET  /edge-types/{id}                      {edge_type_counts, total_edges}
POST /set-default/{id}                     point "default" at a graph_id or a graph_storage file
```

**Shared:**
```
POST /upload/                              register an uploaded NetworkX JSON (≤ 50 MB) → graph_id
GET  /health/                              {status: "healthy", graph_count}
```

**Modular:**
```
GET  /datasets/                            built-in list + structural summary
POST /datasets/load/{name}                 load a built-in → graph_id
GET  /schema/{id}                          counts, types, ranges, structural flags, auto_promoted
GET  /metrics/{id}                         DEAD CODE — kept only for the upstream test suite
GET  /degree-fit/{id}                      theoretical fits + by-type
GET  /components/{id}                      WCC (+ SCC if directed) breakdown
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
GET  /ego/{id}/{node}                      k-hop subgraph (cap/timeout guarded)
GET  /node-inspect/{id}/{node}             inspector envelope + neighbor preview
GET  /node-neighbors/{id}/{node}           paginated neighbor list
GET  /edge-inspect/{id}/{edge}             per-edge inspector payload
```

Pure-function payloads are cached per graph in `registry.Caches`;
`invalidate_caches(graph_id)` clears everything on (re)register.

## Centrality pipeline

On `/upload/` and `/datasets/load/`, the server cancels any running precompute, wipes
the caches, then starts **spectral → betweenness → closeness** (fastest first) in the
threadpool. The data endpoints return `200` ready / `202` in-flight / `410` cancelled
/ `500` error / `404` unknown id. The frontend polls `/centrality-status/` only.

## Conventions

- **`main.py` = wiring.** Pure-function payloads go through
  `cached_endpoint(cache_name, compute_fn)`; everything else stays thin and delegates.
- **Type lookups single-sourced in `schema.py`** (`node_type` / `edge_type`); JSON
  coercion through `json_scalar`. Never inline `.get('Node Type', ...)`.
- **`async def` only with a real `await`.** Sync I/O in a `def` handler runs in the
  threadpool; in an `async def` it blocks every request.
- **`except HTTPException: raise` before `except Exception`**, so validation 4xx
  don't become 500s.
- **No endpoint receives or applies a filter** (see *Design model*).
- **GZip middleware** compresses payloads ≥ 1 KB (SoA payloads shrink ~70–80%).

## Extending without breaking compatibility

Two constraints, both binding:

1. **The upstream API contract.** This backend is meant to land upstream as an
   additive PR. Keep the legacy endpoints' shapes and status codes fixed, keep the
   imports `tests/conftest.py` relies on (`app`, `graph_registry`,
   `GRAPH_STORAGE_DIR`, `default_graph_id`), keep CORS origins explicit, keep
   `/health/` at `{status: "healthy", graph_count}`.
2. **The internal design model.** Never accept a filter; refer to nodes/edges by
   their canonical index; compute metrics on the full graph once; use `schema.py` for
   type lookups.

Recipe for a new panel endpoint: create `myfeature.py` with a pure
`compute_myfeature(G) -> dict`; wire it with `cached_endpoint('myfeature', ...)` and
add the cache name to `registry.Caches`; keep the handler ≤ 5 lines. Verify with
`python3 -c "import main"`, then run the test suite.

## Testing

```bash
pip install pytest httpx   # or: ./dev.sh --dev (installs + runs the suite)
python3 -m pytest tests/ -q
```

The upstream suite (`test_api.py`, `test_cors.py`, `test_default_graph_file.py`) is
vendored unchanged alongside the modular suite (`test_modular.py`); all tests must
pass. The only local addition is a `conftest.py` fixture that writes a synthetic
`graph_storage/default-graph.json` with MC1's type names — upstream that file is the
MC1 graph itself, which cannot be redistributed. A real local `default-graph.json` is
left untouched. Details in [`tests/README.md`](tests/README.md).

## Team

Contributions to this folder, from the git history:

- **Salvo Rinzivillo** — the original upstream API this backend extends: the upload /
  summary / node-types / edge-types / set-default endpoints, the CORS configuration,
  and the API-contract test suite (vendored here as `legacy_compat.py` + `tests/`).
- **Francesco Secoli** ([@sclfnc](https://github.com/sclfnc)) — the modular backend:
  the stateless design model, the SoA node/edge/attribute indices, the per-panel
  analysis endpoints, the async centrality pipeline, schema/auto-promotion, caching,
  and the modular test suite.
