# Backend — Architecture

FastAPI server: loads a graph, computes graph-analysis payloads per panel, serves them as JSON.
NetworkX for graph ops, NetworKit for centralities (pure NetworkX is too slow at MC1 scale),
`powerlaw` for degree-distribution fits. **Read-only and stateless across restarts** — the registry
is in-memory, so restarting the server clears every loaded graph. The Vue frontend is the only client.

For setup and how to run the tests, see [`api/README.md`](../../api/README.md).

## Design model (read this first)

The backend never sees a filter. It is **stateless with respect to the user's exploration state** — it
ships the *whole* graph (plus the indices the client needs to slice it fast), and the browser does all
the filtering and selection locally. This single rule explains most of the choices below:

- **Full-graph payloads.** `/nodes/`, `/edges/`, `/attribute-index/`, `/timeline/` return every
  node/edge, not a filtered subset. There is no `?filter=` query param anywhere.
- **Stable indices are the contract.** Nodes ship in one fixed order (degree-desc); a node's
  position is its `node_idx`. Edges ship in one fixed walk order; an edge's position is its
  `edge_id`. Every payload refers to a node or edge by that index. The client builds a bitmask over
  these indices and intersects it with whatever it draws, so a filter "dims" marks without the
  backend recomputing anything.
- **Metrics are computed once, on the full graph.** Degree fits, centralities, assortativity,
  components all describe the whole graph; the client never asks the backend to recompute them under a
  filter.
- **Two exceptions, on purpose:** `/type-mixing/` and `/edge-flow/` ship *metadata only*. Their
  matrix/flow **counts** are recomputed in the browser from the edge SoA so edge filters reach them;
  recomputing those counts in Python would mean sending a filter to the server, which the model
  forbids.
- **Effective types.** Some graphs have a single `Node Type`/`Edge Type` plus one attribute that is
  really the type (Karate's `club`, Davis' `bipartite`). `/schema/` marks this as `auto_promoted`, and
  `/effective-types/` ships per-item labels so the client can group/colour by it. Type lookups have a
  single source in `schema.py` (`node_type`/`edge_type`).

## Module layout

The files are flat (one package, no sub-folders) but grouped by role. `main.py` is **wiring only** —
each endpoint is a few lines that hand off to a feature module. Every feature module is one file, owns
one concern, depends on the *core* layer, and nothing depends on it except `main.py`.

**Core — shared by everything.**

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app, middleware (CORS + GZip), endpoint wiring, `cached_endpoint` helper |
| `registry.py` | in-memory graph registry + `Caches` dict + `load_graph` + `invalidate_caches` |
| `schema.py` | the shared hub: `compute_schema`, auto-promotion, **single source of truth** for type lookups (`node_type` / `edge_type`), JSON coercion (`json_scalar`), `percentile`, reserved-attr constants, built-in loaders |

**Indices — the canonical orderings other modules build on.**

| Module | Responsibility |
|---|---|
| `node_index.py` | per-node SoA payload + the canonical **degree-desc** node order (source of `node_idx`) |
| `edge_index.py` | per-edge SoA payload + the `(u, v[, key]) → edge_id` map (source of `edge_id`) |
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
| `timeline.py` | per-attribute temporal binning + per-bin SoA indices |
| `ego.py` | k-hop ego subgraph (BFS, cap + timeout guarded) |
| `inspectors.py` | per-node + per-edge inspector payloads (named `inspectors`, not `inspect`, to avoid shadowing the stdlib module) |

**Lifecycle / data.**

| Module | Responsibility |
|---|---|
| `datasets.py` | built-in loaders + eager structural summary for the onboarding picker |
| `builtin_download.py` | on-demand fetch of the two external built-ins (email-eu/SNAP, MovieLens/GroupLens) on first load |
| `precompute.py` | async centrality pipeline (`kickoff` / `cancel_all`) |

**Compatibility (upstream original — not part of the modular design).**

| Module | Responsibility |
|---|---|
| `legacy_compat.py` | the 4 legacy endpoints from the shared API repo (`/summary/`, `/node-types/`, `/edge-types/`, `/set-default/`) + `default_graph_id`, copied unchanged so the upstream `tests/` suite passes. Kept in one file; the modular layer never depends on it. |

### Dependency shape

The imports form a clean tree: every module depends on `schema.py` at the bottom, and `main.py`
sits on top and connects everything. There are no import cycles.

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

Read top-down to extend, bottom-up to understand. `schema.py` imports no local module; `registry.py`
imports only `schema`; every feature module imports `schema` (plus `registry` and an index module when
it needs the canonical order); `main.py` imports them all.

### Two contracts coexist

The app serves **two parallel contracts at once**, by design:

- the **legacy** contract (`legacy_compat.py`) — the original upstream endpoints, kept byte-for-byte so
  the shared repo's `tests/` suite still passes unchanged;
- the **modular** contract — this backend's own endpoints that feed the dashboard.

They live side by side: the legacy layer sits in one file and the modular layer never depends on it.
When you touch the backend, be clear which contract you're in.

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

Two contracts share one app. **Legacy** endpoints come from the upstream API repo and stay unchanged
so its `tests/` suite passes (`legacy_compat.py`). **Modular** endpoints are this backend's own, one
feature module each. `/upload/` and `/health/` satisfy both.

**Legacy (upstream contract):**
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
GET  /metrics/{id}                         degree sequence + stats + degree_by_type — DEAD CODE (see note below)
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

`/metrics/` is **dead code**: no frontend code calls it (the Degree Distribution panel derives degree
from the `/nodes/` SoA + `/degree-fit/` instead). It is kept only because the upstream `tests/` suite
(`test_modular.py`) still exercises it — removing the endpoint would break that test. Do not build new
work on it.

Per-graph results are cached in `registry.Caches` (`schema`, `degree_fit`, `components`, `node_index`,
`node_order`, `edge_index`, `edge_index_map`, `graph_object`, `edge_flow`, `type_mixing`, `timeline`,
`attribute_index`, `effective_types`) plus specialized caches (centrality status/data, ego LRU).
`invalidate_caches(graph_id)` clears all of them on (re)register.

## Conventions

- **`main.py` = wiring.** New endpoints follow the `cached_endpoint(cache_name, compute_fn)` pattern
  when the payload is a pure function of the graph; otherwise stay thin and delegate.
- **Type lookups single-sourced in `schema.py`.** Use `node_type(G, n)` / `edge_type(data)`, never
  inline `.get('Node Type'/'Edge Type', 'Unknown')`. JSON coercion goes through `json_scalar`.
- **`async def` only with a real `await`.** Sync I/O in a `def` handler runs in FastAPI's threadpool;
  an `async def` with sync I/O blocks every request while it runs.
- **Exception order:** `except HTTPException: raise` before `except Exception`, so validation 4xx
  don't get turned into 500s.
- **Stateless w.r.t. filters** (see *Design model*). No endpoint receives or applies a filter.
- **GZip middleware** compresses payloads ≥ 1 KB (the SoA / index payloads shrink ~70–80%).

## Extending the backend without breaking compatibility

"Compatibility" means two things; an extension must respect both.

**1. Don't break the upstream API contract.** This codebase is meant to land on the shared API
repository as an **additive** PR, keeping the existing endpoints working so the upstream `tests/` suite
still passes. Keep the legacy endpoints' shape (down to the nested keys the tests check) and status
codes fixed; keep the imports `tests/conftest.py` relies on
(`from main import app, graph_registry, GRAPH_STORAGE_DIR, default_graph_id`); keep CORS readable
(explicit `allow_origins=[...]`); keep `/health/` at `{status: "healthy", graph_count}`.

**2. Don't break the internal design model.** New endpoints stay inside the *Design model*: never
accept a filter; refer to nodes/edges by their canonical index (`node_index.get_node_order`,
`edge_index.get_edge_index_map`); compute metrics on the full graph once (no "recompute under filter"
path beyond the two closed exceptions); use the single source for type lookups, `schema.node_type` /
`schema.edge_type`.

### Recipe: add a new panel endpoint

1. Create `myfeature.py` with a pure `compute_myfeature(G) -> dict` (JSON-safe; coerce odd values via
   `schema.json_scalar`).
2. If the payload is a pure function of the graph, wire it in `main.py` with
   `cached_endpoint('myfeature', compute_myfeature)` and add `'myfeature'` to `registry.Caches`.
3. Keep the handler ≤ 5 lines; put logic in the module.
4. `async def` only if you actually `await`.
5. `except HTTPException: raise` before `except Exception:`.
6. Verify: `python3 -c "import main"` (catches import cycles / shadowing), then run the upstream
   `tests/` suite.

## Centrality pipeline

On `/upload/` and `/datasets/load/`, the server cancels any running precompute (it awaits each task
before clearing its registry), wipes caches, then starts **spectral → betweenness → closeness**
(fastest first), each in the default threadpool so the event loop stays responsive. The three
`/centrality/...` data endpoints return `200 {data}` when ready, `202 {status}` in-flight, `410`
cancelled, `500` on error, `404` for unknown id. The frontend polls `/centrality-status/` only.
