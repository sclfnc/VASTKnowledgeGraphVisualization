# Telescope — Backend

FastAPI server: loads a graph, computes graph-analysis payloads per panel, serves them as JSON.
NetworkX for graph ops, NetworKit for centralities (pure NetworkX is too slow at MC1 scale),
`powerlaw` for degree-distribution fits. **Read-only and stateless across restarts** — the registry
is in-memory, so restarting the server clears every loaded graph.

The frontend (a Vue 3 dashboard, separate folder) is the only client. This README is
self-contained: everything you need to read, run, and extend the backend is here.

## Design model (read this first)

The backend never sees a filter. It is **stateless with respect to the user's exploration
state** — it ships the *whole* graph (plus the indices the client needs to slice it fast),
and the browser does all filtering and selection locally. This is the single design rule that
explains most of the choices below:

- **Full-graph payloads.** `/nodes/`, `/edges/`, `/attribute-index/`, `/timeline/` return
  every node/edge, not a filtered subset. There is no `?filter=` query param anywhere.
- **Stable indices are the contract.** Nodes are shipped in one canonical order (degree-desc);
  a node's position in that order is its `node_idx`. Edges are shipped in one canonical walk
  order; an edge's position is its `edge_id`. Every payload that refers to a node or edge does
  so by that index (`source[i]`/`target[i]`, the `idx` lists in `/timeline/`, the buckets in
  `/attribute-index/`). The client builds a bitmask over these indices and intersects it with
  whatever it draws — so a filter "attenuates" marks without the backend recomputing anything.
- **Metrics are computed once, on the full graph.** Degree fits, centralities, assortativity,
  components — all describe the whole graph. The client never asks the backend to recompute them
  under a filter; it just dims the marks that fall outside the current mask.
- **Two deliberate exceptions:** `/type-mixing/` and `/edge-flow/` ship *metadata only* (type
  lists, Newman assortativity, node counts). Their matrix/flow **counts** are recomputed in the
  browser from the edge SoA so that edge filters propagate to them — recomputing those counts in
  Python would mean shipping a filter to the server, which the model forbids.
- **Effective types.** Some graphs have a single `Node Type`/`Edge Type` plus one attribute that
  is really the type (Karate's `club`, Davis' `bipartite`). `/schema/` flags this as
  `auto_promoted`, and `/effective-types/` ships per-item labels for that attribute so the client
  can group/colour by it. Type lookups are single-sourced in `schema.py` (`node_type`/`edge_type`).

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

Four built-ins (karate, les_misérables, florentine, davis) are generated in-process by NetworkX and
need nothing. The two larger ones — **email-eu-core** (SNAP, BSD) and **MovieLens** (GroupLens,
CC BY 4.0) — are **fetched from their official host on first load** and cached in
`graph_storage/builtin_data/` (see `builtin_download.py`); they are not committed. A failed download
degrades to a `503` for that dataset, not a crash. First load of those two needs network access.

## Module layout

The files are flat (one package, no sub-folders) but grouped by role below. `main.py` is
**wiring only** — each endpoint is a few lines that delegate to a feature module. Every feature
module is one file, owns one concern, and depends on the *core* layer; nothing depends on a
feature module except `main.py`.

**Core — shared by everything.**

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app, middleware (CORS + GZip), endpoint wiring, `cached_endpoint` helper |
| `registry.py` | in-memory graph registry + `Caches` dict + `load_graph` + `invalidate_caches` |
| `schema.py` | the shared hub: `compute_schema`, auto-promotion, **single source of truth** for type lookups (`node_type` / `edge_type`), JSON coercion (`json_scalar`), `percentile`, reserved-attr constants, built-in dataset loaders |

**Indices — the canonical orderings other modules build on.**

| Module | Responsibility |
|---|---|
| `node_index.py` | per-node SoA payload + the canonical **degree-desc** node order (the source of `node_idx`) |
| `edge_index.py` | per-edge SoA payload + the `(u, v[, key]) → edge_id` map (the source of `edge_id`) |
| `attribute_index.py` | per-(type, attr) filter buckets (categorical / numeric / boolean / temporal / text) |
| `effective_types.py` | per-item effective type labels when an attribute is auto-promoted to type |

**Analysis — one panel's payload each.**

| Module | Responsibility |
|---|---|
| `degree_fit.py` | power-law / exponential / Poisson / log-normal fits (CSN framework) |
| `components.py` | WCC / SCC breakdown |
| `centrality.py` | NetworKit wrappers + `centrality_response(graph_id, measure)` dispatcher |
| `type_mixing.py` | mixing-matrix metadata + Newman assortativity |
| `edge_flow.py` | flow metadata (type lists, node counts) |
| `timeline.py` | per-attribute temporal binning (configurable parse strategy) + per-bin SoA indices |
| `ego.py` | k-hop ego subgraph (BFS, cap + timeout guarded) |
| `inspectors.py` | per-node + per-edge inspector payloads (named `inspectors`, not `inspect`, to avoid shadowing the stdlib module) |

**Lifecycle / data.**

| Module | Responsibility |
|---|---|
| `datasets.py` | built-in dataset loaders + eager structural summary for the onboarding picker |
| `builtin_download.py` | on-demand fetch of the two external built-ins' source files (email-eu/SNAP, MovieLens/GroupLens) into `graph_storage/builtin_data/` on first load |
| `precompute.py` | async centrality pipeline (`kickoff` / `cancel_all`) |

**Compatibility (upstream original — not part of the modular design).**

| Module | Responsibility |
|---|---|
| `legacy_compat.py` | the 4 legacy endpoints from the shared API repo (`/summary/`, `/node-types/`, `/edge-types/`, `/set-default/`) + the `default_graph_id` constant, replicated verbatim so the upstream `tests/` suite passes. Isolated on purpose; deletable once the group migrates. |

### Dependency shape

A clean DAG rooted at `schema.py`, with `main.py` as the single orchestrator on top:

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

Read top-down to extend, bottom-up to understand. `schema.py` imports no local module;
`registry.py` imports only `schema`; every feature module imports `schema` (+ `registry` and an
index module when it needs the canonical order); `main.py` imports them all.

### Two contracts coexist

This app serves **two parallel contracts at once**, by design:

- the **legacy** contract (`legacy_compat.py`) — the original upstream endpoints, kept byte-for-byte
  in behaviour so the shared repo's `tests/` suite passes unchanged;
- the **modular** contract — this backend's own 23 endpoints feeding the dashboard.

They live side by side: the legacy layer is isolated in one file and the modular layer never depends
on it. This is intentional so the PR is *additive* (nothing the upstream relied on is removed) and so
the compatibility shim can be deleted in one step once the group adopts the modular API. When you
touch the backend, be clear which contract you're working in — see *Extending* below.

### Where do I look to…

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

Two contracts share one app. **Legacy** endpoints come from the upstream API repo and are kept
unchanged so its `tests/` suite passes; they live in `legacy_compat.py`. **Modular** endpoints are
this backend's own, one feature module each. `/upload/` and `/health/` satisfy both contracts.

**Legacy (upstream contract — `legacy_compat.py`):**
```
GET  /summary/{id}                         full structural summary (upstream nested shape)
GET  /node-types/{id}                      {node_type_counts, total_nodes}
GET  /edge-types/{id}                      {edge_type_counts, total_edges}
POST /set-default/{id}                      point "default" at a graph_id or a graph_storage file
```

**Shared by both contracts:**
```
POST /upload/                              register an uploaded NetworkX JSON (≤ 50 MB) → graph_id
GET  /health/                              {status: "healthy", graph_count}
```

**Modular (this backend's own):**
```
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
- **Stateless w.r.t. filters** — see *Design model* above. No endpoint receives or applies a
  filter; full-graph payloads + stable indices only.
- **GZip middleware** compresses payloads ≥ 1 KB (the SoA / index payloads shrink ~70–80%).

## Testing (upstream suite)

The compatibility target is the upstream repo's `tests/` suite (`test_api.py`, `test_cors.py`,
`test_default_graph_file.py`). It is **not vendored in this branch** — copy it in to run it:

```bash
pip install pytest httpx
# drop the upstream tests/ folder into api/tests/, then:
python3 -m pytest tests/ -q
```

Expected: **all API-contract tests pass** (upload, summary, node/edge types, set-default, health,
CORS, full workflow). The only failure/skips come from `test_default_graph_file.py`, which is an
**environmental** test, not part of the committed contract:

- It expects `graph_storage/default-graph.json` to already exist on disk — an **MC1-shaped** graph
  (asserts node types like `Person` / `Song` / `RecordLabel`).
- `graph_storage/` is gitignored (here *and* upstream), so the file is never committed. MC1 itself
  is the VAST Challenge dataset and **is not redistributable**, so we deliberately do not ship it.
- Result: `test_default_graph_file_exists` fails and the other 5 in that file `pytest.skip`
  themselves — the same outcome you get in the upstream repo without the file. To run them green,
  place an MC1-shaped graph at `graph_storage/default-graph.json` locally (not committed).

## Extending the backend without breaking compatibility

"Compatibility" here means two things, and an extension must respect both.

### 1. Don't break the upstream API contract

This codebase is meant to land on the shared API repository as an **additive** PR: it keeps the
existing endpoints working so the upstream `tests/` suite still passes. If you change anything in
this layer, run that suite before opening a PR.

- **Keep the legacy endpoints' shape.** `/upload/`, `/summary/`, `/node-types/`, `/edge-types/`,
  `/set-default/`, `/health/` are the upstream contract. Their response shape (down to the nested
  keys the tests assert) and status codes are frozen. Add fields if you must, never remove or rename.
- **Keep the import surface the tests rely on.** `tests/conftest.py` does
  `from main import app, graph_registry, GRAPH_STORAGE_DIR, default_graph_id`. Those names must
  stay importable from `main`. If you move a symbol, re-export it from `main`.
- **Keep CORS introspectable.** A test reads `CORSMiddleware.kwargs["allow_origins"]` and expects
  `"http://localhost"` / `"http://127.0.0.1"` in the list. Keep an explicit `allow_origins=[...]`
  on the middleware even if you also use a regex.
- **`/health/` returns `{status: "healthy", graph_count}`.** Already aligned to upstream — don't
  revert it to `{status: "ok"}`.

### 2. Don't break the internal design model

New endpoints must stay inside the *Design model* (top of this file). Concretely:

- **Never accept a filter.** No `?filter=`, no "give me only nodes of type X". Ship the full graph
  (or full per-attribute index) and let the client mask. The only state a handler reads is
  `graph_id`.
- **Refer to nodes/edges by their canonical index.** If a new payload points at nodes or edges, use
  the degree-desc `node_idx` (`node_index.get_node_order`) and the walk-order `edge_id`
  (`edge_index.get_edge_index_map`). Don't invent a second ordering — the client's bitmasks assume
  this one.
- **Compute metrics on the full graph, once.** Don't add a "recompute under filter" path. The two
  client-side-aggregation exceptions (`type_mixing`, `edge_flow`) are deliberate and closed; adding
  a third needs a real justification.
- **Single-source type lookups.** Use `schema.node_type(G, n)` / `schema.edge_type(data)`. The only
  allowed `'Node Type'` / `'Edge Type'` literals elsewhere are NetworkX *attribute-name* arguments
  (e.g. `attribute_assortativity_coefficient(H, 'Node Type')`), never value lookups.

### Recipe: add a new panel endpoint

1. Create `myfeature.py` with a pure `compute_myfeature(G) -> dict` (JSON-safe; coerce odd values
   through `schema.json_scalar`).
2. If the payload is a pure function of the graph, wire it in `main.py` with
   `cached_endpoint('myfeature', compute_myfeature)` and add `'myfeature'` to `registry.Caches`.
   That's all the caching + invalidation you need.
3. Keep the handler ≤ 5 lines; put logic in the module.
4. `async def` only if you actually `await`. Sync I/O in a plain `def` runs in the threadpool.
5. `except HTTPException: raise` before `except Exception:` so 4xx aren't masked as 500s.
6. Verify: `python3 -c "import main"` (catches import cycles / shadowing), then run the upstream
   `tests/` suite.

## Centrality pipeline

On `/upload/` and `/datasets/load/`, the server cancels any running precompute (awaits each task
before draining its registry), wipes caches, then kicks off **spectral → betweenness → closeness**
(fastest first), each in the default threadpool so the event loop stays responsive. The three
`/centrality/...` data endpoints return `200 {data}` when ready, `202 {status}` in-flight, `410`
cancelled, `500` on error, `404` for unknown id. The frontend polls `/centrality-status/` only.
