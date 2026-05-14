# Telescope

> *Zoom into your graph.*

A visual analytics prototype for structured exploration of knowledge graphs.
**Zero-code, a-lot-knowledge:** load a graph, get the main metrics computed, visualised, and interactively explorable — no notebook, no `nx.degree_centrality(G)`, no boilerplate.

Developed for an academic project on visual analytics for knowledge graphs (Course on Visual Analytics, VAST Challenge 2025 — Design Challenge).

**Status:** v0.4.0 — work in progress, less than a prototype.
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

Telescope organises a panel registry around three states:

| Status      | Panel                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Implemented | **Degree Distribution** — PMF / CCDF, by-type breakdown, four theoretical fits (power-law, exponential, log-normal, Poisson) via the `powerlaw` package, IQR-based outlier highlight |
| Implemented | **Connected Components** — bubbles or bars view, WCC / SCC modes, range and rank filters, click-to-drill into a side-by-side breakdown by node type |
| Planned     | PageRank & Eigenvector, Betweenness, Closeness, Ego Network, Type Mixing Matrix, Activity Timeline |
| Stub        | ~20 spec entries kept in the registry as a roadmap reference but filtered from the UI |

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

The API exposes `POST /upload/`, `GET /datasets/`, `POST /datasets/load/{name}`, `GET /schema/{graph_id}`, `GET /metrics/{graph_id}` (legacy, used by `DegreeDistribution`), `GET /degree-fit/{graph_id}` (powerlaw fits), `GET /components/{graph_id}` (WCC/SCC breakdown), and `GET /health/`. Registry and result caches are in-memory.

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

The six planned panels cover the main backend interaction patterns we want to demonstrate:

- **PageRank & Eigenvector** — centrality for propagation importance
- **Betweenness** — structural bridges and bottlenecks
- **Closeness** — average reachability
- **Ego Network** — interactive local neighbourhood around a selected node
- **Type Mixing Matrix** — heterogeneity: edge counts between node types, surfacing semantic anomalies
- **Activity Timeline** — temporal evolution for graphs that expose date attributes

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
