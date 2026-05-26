# Telescope

> *Zoom into your graph.*

A visual analytics prototype for structured exploration of knowledge graphs.
**Zero-code, a-lot-knowledge:** load a graph, get the main metrics computed, visualised, and interactively explorable — no notebook, no `nx.degree_centrality(G)`, no boilerplate.

Developed for an academic project on visual analytics for knowledge graphs (Course on Visual Analytics, VAST Challenge 2025 — Design Challenge).

**Status:** v0.4.1 — work in progress, less than a prototype.
**Branch:** `api-integration`
**Current focus:** the entire effort is on **Guide mode**. Graph mode is intentionally a placeholder for now.

---

## Who it's for

Two audiences, one surface:

- **Data scientists** approaching a new graph who want a structured first pass — degree distribution, centralities, components, assortativity, k-core, etc. — without writing any code. Each panel is a metric *photographed* on the loaded data and made interactive.
- **Non-expert users** (the VAST Challenge target) who want to understand what those metrics mean, why they matter, and what a "good" or "anomalous" reading looks like — through theory drawers attached to every panel.

The same wiki serves both: the data scientist reads the chart, the non-expert reads the explanation, and both can drill into the same focus modal.

---

## What it does today

Telescope organises a panel registry. Currently implemented:

| Section | Panel | Notes |
|---|---|---|
| Descriptive | **Degree Distribution** | PMF / CCDF, by-type breakdown, four theoretical fits (power-law, exponential, log-normal, Poisson) via the `powerlaw` package, IQR-based outlier highlight |
| Descriptive | **Connected Components** | bubbles or bars view, WCC / SCC modes, range and rank filters, click-to-drill side-by-side breakdown by node type |
| Descriptive | **Node / Edge Attribute Schema** | per-type attribute coverage matrix or attribute-first view, shared-attr highlight, coverage threshold filter |
| Centrality | **PageRank · Eigenvector · Betweenness · Closeness** | parametric `CentralityPanel` (rank-mass bars, decay-from-core boxplots, Lorenz + Gini, per-type violins, generic Deg-vs-Centrality scatter) |
| Centrality | **Centrality Comparison** | 4×4 scatter matrix: mini-scatters in the lower triangle, correlation heat-cells in the upper |
| Ego | **Ego Network** | k-hop subgraph around a selected node, direction Out/In/Both on directed graphs, breadcrumb navigation |
| Ego | **Ego Comparison** | multi-ego (up to 4) union/intersection view with pie-wedge node encoding |
| Mixing | **Type Mixing Matrix** | type × type heatmap, Newman assortativity, per-edge-type r bars on widen |
| Mixing | **Edge Flow** | radial meta-graph: types on a circle, edge flows as colored arcs |
| Temporal | **Activity Timeline · Nodes / Edges** | stacked-by-type bars over years, brush writes a scoped temporal filter (separate panel per scope) |

Stub entries (~20) live in `ALL_SPECS` as roadmap reference, filtered from the UI via `PANEL_SPECS = ALL_SPECS.filter(p => p.status !== 'stub')`.

Each panel renders a chart in the grid and exposes a theory drawer inside the focus modal — the drawer is meant for non-experts who want to understand the metric, the in-grid chart is for the data scientist scanning for signal.

A schema endpoint inspects the loaded graph and drives:
- conditional panels (e.g. *Reciprocity* only for directed graphs, *Edge Weight* only when weighted, *Cross-type Matrix* only when heterogeneous),
- dynamic filters (node/edge types, degree, weight, attributes — numeric / categorical / boolean),
- the overview card with structural badges (multigraph, bipartite, DAG, self-loops).

---

## Stack

| Area     | Tech                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Frontend | Vue 3 · Vite · Pinia · Vue Router · Tailwind CSS v4 · D3 · Lucide · @vueform/slider |
| Backend  | FastAPI · NetworkX · powerlaw (CSN distribution fits)                               |
| Analysis | NetworkX · NetworKit · pandas · Jupyter                                             |

---

## Repository layout

```
.
├── api/              FastAPI server (graph registry, schema, dataset loader)
├── frontend/         Vue 3 SPA — onboarding, header, Graph + Guide modes
├── data/             Datasets (gitignored)
├── docs/             Meeting notes, design rationale
├── done.md           Progress log — updated after each session
└── CLAUDE.md         Architecture + conventions reference
```

---

## Running locally

### Backend

```bash
cd api
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API exposes dataset endpoints (`POST /upload/`, `GET /datasets/`, `POST /datasets/load/{name}`), schema (`GET /schema/{graph_id}`), per-panel data endpoints (`/metrics/`, `/degree-fit/`, `/components/`, `/nodes/`, `/edges/`, `/ego/`, `/type-mixing/`, `/edge-flow/`, `/timeline/`), centrality with async precompute pipeline (`/centrality-status/`, `/centrality/spectral/`, `/centrality/betweenness/`, `/centrality/closeness/`), and `GET /health/`. Registry and result caches are in-memory — restarting the server clears them. See `CLAUDE.md` for full endpoint contracts.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite serves on `:5173` and proxies to the FastAPI host on `:8000`. Node `^20.19.0 || >=22.12.0`.

### Convenience

A root-level `dev.sh` launches both processes in parallel and shuts them down together on `Ctrl+C`. It auto-activates `api/venv` if present.

---

## Built-in datasets

Four NetworkX datasets are exposed via `GET /datasets/`:

- **karate** — Zachary's Karate Club
- **les_miserables** — co-appearance graph
- **florentine** — Florentine families
- **davis** — Davis Southern Women (bipartite)

These are normalized at load time to expose `Node Type` / `Edge Type` keys (Mr. Hi / Officer for karate, Woman / Event for davis, etc.) so the schema endpoint works uniformly with the MC1 convention.

---

## Coming next

The current focus is the **filter & selection propagation refactor** (see `PROPAGATION.md` at repo root): wire all 10 panels to a global filter contract via a Uint32-packed bitset (`useFilteredModel` → `usePanelContext`), introduce per-panel Pin (lens-on-subset) and Isolation (full freeze), and surface a filter history with undo/redo arrows in `GraphContextBar`. Mask-only semantics: filters attenuate marks, never recompute metrics.

After the propagation layer, the next batch of panels (stub → planned → implemented) covers triadic closure, k-core decomposition, assortativity, degree correlation, and community detection (Louvain / Label Propagation).

---

## Known limitations

### Node attribute filtering not implemented

The `GraphContextBar` exposes filters for **node type** and **degree** only. Filtering by arbitrary node attributes (e.g. `department = 5` on Email-Eu-Core, `release_year > 2000` on MovieLens) is not supported.

This is a deliberate deferral, not an oversight. Adding it requires:
1. Extending `filters.js` with a dynamic `nodeAttrs` map (`attrName → {kind, value/range}`).
2. Making `useFilteredModel` consume `useGraphNodes` (currently separate) and apply per-attribute predicates against the full node data — O(N) per active attribute filter.
3. Designing a generic UI that handles numeric ranges, categorical multi-selects, and boolean toggles from a schema-driven spec.

Node **type** filtering carries none of this overhead — it is already implemented via pre-built `typeMasks` bitsets in `useFilteredModel`, with O(1) lookup per node. The cost difference between the two is structural, not incremental.

Attribute-level filtering belongs in a dedicated task once the panel audit and visual redesign are complete.

### Multigraph parallel edges in EgoComparison

`mergeLayers` in `panels/layeredGraph.js` groups edges by `(source, target, type)`, so parallel edges on multigraphs collapse to a single visual record and reference only the first `edge_id` encountered. Acceptable trade-off for the multi-ego comparison use case (where parallel-edge resolution is not the focus). Single-ego view (`EgoNetworkPanel`) preserves every parallel edge.

---

## Notes on MC1

The reference dataset (`data/MC1_release/MC1_graph.json`) is a directed multigraph: 17,412 nodes / 37,857 edges, 16 weakly connected components, LCC covers >99%. Five node types (`Person`, `Song`, `RecordLabel`, `Album`, `MusicalGroup`), twelve edge types. Centralities are computed via NetworKit because pure NetworkX is too slow at this scale.

Detailed metrics, anomalies, and the NetworKit ↔ NetworkX mapping pattern are in `CLAUDE.md`.

---

## Author

Francesco Secoli — [github.com/sclfnc](https://github.com/sclfnc)

Repository: [github.com/sclfnc/VASTKnowledgeGraphVisualization](https://github.com/sclfnc/VASTKnowledgeGraphVisualization/tree/api-integration)

---

## References

- VAST Challenge 2025 — Design Challenge: <https://vast-challenge.github.io/2025/DC.html>
- IEEE VIS / VAST community resources on visual analytics, graph visualization, and knowledge graphs
