# Telescope

> *Zoom into your graph.*

A visual analytics prototype for structured exploration of knowledge graphs.
**Zero-code, a-lot-knowledge:** load a graph, get the main metrics computed, visualised, and
interactively explorable — no notebook, no `nx.degree_centrality(G)`, no boilerplate.

Developed for an academic project on visual analytics for knowledge graphs (Course on Visual
Analytics, VAST Challenge 2025 — Design Challenge).

**Status:** v0.6.0 — work in progress.
**Branch:** `api-integration`
**Current focus:** the entire effort is on **Guide mode**. Graph mode is intentionally a placeholder.

> **Collaboration model:** the design and implementation of this dashboard are the author's own — its architecture, interaction model (the bitmap-truth contract, mask-only propagation, the panel system), analytical goals, and the bulk of the code were conceived and written by the author. [Claude Code](https://claude.com/claude-code) was used on top of that existing, author-written codebase as an assistant for **refactoring, documentation, and translating already-formed ideas into code** — tightening structure, writing tests, and articulating decisions the author had already made. It did not originate the design and did not author the dashboard; it worked within a system that was already built. Every design decision, trade-off, and final acceptance is the author's.
>
> AI assistance is **pervasive across the codebase** and always interleaved with manual edits. The `Co-Authored-By` commit trailer marks only the subset of commits authored end-to-end by the assistant in a single pass, with no human edit in between — so the trailer is a partial, not exhaustive, record of AI involvement, never of authorship.

---

## Who it's for

Two audiences, one surface:

- **Data scientists** approaching a new graph who want a structured first pass — degree distribution,
  centralities, components, assortativity — without writing code. Each panel is a metric *photographed*
  on the loaded data and made interactive.
- **Non-expert users** (the VAST Challenge target) who want to understand what those metrics mean and
  what a "normal" or "anomalous" reading looks like — through a theory drawer attached to every panel.

The data scientist reads the chart, the non-expert reads the explanation, both drill into the same
focus modal.

---

## What it does today

A panel registry drives the Guide-mode grid. 13 panels implemented (registry stubs for ~20 more):

| Section | Panel | Notes |
|---|---|---|
| Descriptive | **Degree Distribution** | PMF / CCDF, by-type breakdown, four fits (power-law, exponential, log-normal, Poisson) via `powerlaw`, IQR outlier highlight, plot-brush degree filter |
| Descriptive | **Connected Components** | bubbles or bars, WCC / SCC modes, range & rank filters, click-to-drill breakdown by node type |
| Centrality | **PageRank · Eigenvector · Betweenness · Closeness** | parametric `CentralityPanel` (rank-mass bars, decay-from-core boxplots, Lorenz + Gini, per-type violins, generic Deg-vs-Centrality scatter) |
| Centrality | **Centrality Comparison** | 4×4 scatter matrix: mini-scatters lower triangle, correlation heat-cells upper |
| Local | **Ego Network** | k-hop subgraph around a node, direction Out/In/Both on directed graphs, breadcrumb navigation |
| Local | **Ego Comparison** | multi-ego (up to 4) union/intersection with pie-wedge node encoding |
| Mixing | **Type Mixing Matrix** | type × type heatmap, Newman assortativity, per-edge-type r bars on widen |
| Mixing | **Edge Flow** | radial meta-graph: types on a circle, edge flows as colored arcs |
| Temporal | **Activity Timeline · Nodes / Edges** | stacked-by-type bars over years, brush writes a scoped temporal filter (one panel per scope) |

Each panel renders a chart in the grid and exposes theory text in the focus modal. Filtering lives in
the left sidebar: a per-type attribute filter editor (`AttributeFilters`, node + edge modes) over
type chips, degree/weight ranges, structural toggles, and per-attribute constraints (categorical,
numeric, boolean, date, and free-text on high-cardinality identifiers). A schema endpoint inspects the
loaded graph and drives conditional panels, the filter UI, and the structural badges (multigraph,
bipartite, DAG, self-loops).

### How it all stays in sync

Every panel reacts to global filters and selection through **three shared bitmaps**
(`activeNodeMask`, `activeEdgeMask`, `selectedMask`) built once in `useFilteredModel` /
`usePanelContext`. **Mask-only semantics:** filters attenuate marks, they never recompute metrics — a
power-law fit or a Gini curve stays anchored to the full graph while the marks dim. Per-panel
Isolation (Lock) freezes a card on its current view. The full contract — what each store owns, the
two documented count-view exceptions, the upstream-write policy — is in **[contract.md](contract.md)**.

---

## Stack

| Area     | Tech                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Frontend | Vue 3 · Vite · Pinia · Vue Router · Tailwind CSS v4 · D3 · Lucide · @vueform/slider |
| Backend  | FastAPI · NetworkX · NetworKit (centralities) · powerlaw (CSN distribution fits)    |

---

## Repository layout

```
.
├── api/              FastAPI server (graph registry, schema, per-panel endpoints, centrality pipeline)
├── frontend/         Vue 3 SPA — onboarding, sidebar, Graph + Guide modes
├── data/             Datasets (gitignored)
├── contract.md       Cross-panel interaction contract (filters/selection bitmaps)
└── README.md         This file
```

`CLAUDE.md` and `report.md` (architecture/conventions reference and system manual) are kept local-only.

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

The API exposes dataset endpoints (`POST /upload/`, `GET /datasets/`, `POST /datasets/load/{name}`),
schema (`GET /schema/{graph_id}`), per-panel data endpoints (`/metrics/`, `/degree-fit/`,
`/components/`, `/nodes/`, `/edges/`, `/ego/`, `/type-mixing/`, `/edge-flow/`, `/timeline/`,
`/attribute-index/`, `/effective-types/`, `/node-inspect/`, `/node-neighbors/`, `/edge-inspect/`),
centrality with an async precompute pipeline (`/centrality-status/`, `/centrality/spectral/`,
`/centrality/betweenness/`, `/centrality/closeness/`), and `GET /health/`. Registry and result caches
are in-memory — restarting the server clears them.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite serves on `:5173` and proxies to the FastAPI host on `:8000`. Node `^20.19.0 || >=22.12.0`.

### Convenience

A root-level `dev.sh` launches both processes in parallel and shuts them down together on `Ctrl+C`.
It creates/activates `api/venv`, installs Python + Node deps on first run (re-installing only when
the requirement/lock hashes change), then starts uvicorn and Vite.

Two optional flags:

- `--dev` — also installs the test-only deps (`pytest`, `httpx` from `api/requirements-dev.txt`) and
  runs the API suite before starting. Failures are reported per test (file, name, one-line error) but
  are **non-blocking** — some are environmental (e.g. the default-graph test needs the
  non-redistributable MC1 graph), so the servers start regardless.
- `--log` — streams full `pip` / `npm` output during install (default is quiet). Useful because
  `networkit` builds from source and can otherwise look stalled.

The flags combine: `./dev.sh --dev --log`.

---

## Built-in datasets

Six datasets are exposed via `GET /datasets/`:

- **karate** — Zachary's Karate Club (auto-promoted on `club`: Mr. Hi / Officer)
- **les_miserables** — co-appearance graph
- **florentine** — Florentine families
- **davis** — Davis Southern Women (bipartite, auto-promoted on `bipartite`)
- **email_eu_core** — Email Eu-Core (directed, real department node types)
- **movielens_small** — MovieLens Small (larger, weighted, temporal)

The four NetworkX graphs are normalized at load time to expose `Node Type` / `Edge Type` keys so the
schema endpoint works uniformly with the MC1 convention. Single-type graphs with one discriminator
attribute (Karate's `club`, Davis' `bipartite`) flow through **auto-promotion**: that attribute
becomes the effective type everywhere (colors, legends, chip group).

---

## Scope and limitations

Design decisions, not oversights:

- **Read-only.** No graph editing; the tool is for exploration and screening, not authoring.
- **No persistence.** In-memory registry; a restart clears loaded graphs. Acceptable for a prototype with no auth and no multi-user requirement.
- **Scale ceiling ~100K edges.** Frontend SoA + bitset and backend NetworKit handle MC1 and MovieLens comfortably; far larger graphs would need a binary wire format and server-side masking, deliberately out of scope.
- **No layout breadth.** Telescope is not a Gephi replacement. It addresses the *exploratory* phase that precedes a full layout/community workflow — the moment when the analyst has not yet decided which metric matters.
- **Mask-only everywhere but two count views.** A documented commitment (see [contract.md](contract.md)), not a limitation to apologize for.
- **Multigraph parallel edges in Ego Comparison.** `mergeLayers` (`panels/layeredGraph.js`) groups edges by `(source, target, type)`, so parallel edges collapse to one visual record referencing the first `edge_id`. The single-ego view (`EgoNetworkPanel`) preserves every parallel edge.

---

## Coming next

The next batch of panels (stub → planned → implemented) covers triadic closure, k-core decomposition,
assortativity, degree correlation, and community detection (Louvain / Label Propagation).

---

## Notes on MC1

The reference dataset (`data/MC1_release/MC1_graph.json`) is a directed multigraph: 17,412 nodes /
37,857 edges, 16 weakly connected components, LCC covers >99%. Five node types (`Person`, `Song`,
`RecordLabel`, `Album`, `MusicalGroup`), twelve edge types. Centralities are computed via NetworKit
because pure NetworkX is too slow at this scale.

---

## Author

Francesco Secoli — [github.com/sclfnc](https://github.com/sclfnc)

Repository: [github.com/sclfnc/VASTKnowledgeGraphVisualization](https://github.com/sclfnc/VASTKnowledgeGraphVisualization/tree/api-integration)

---

## References

- VAST Challenge 2025 — Design Challenge: <https://vast-challenge.github.io/2025/DC.html>
- IEEE VIS / VAST community resources on visual analytics, graph visualization, and knowledge graphs
