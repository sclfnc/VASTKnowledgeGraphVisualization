# Telescope

> *Zoom into your graph.*

A visual analytics prototype for structured exploration of knowledge graphs.
**Zero-code, a-lot-knowledge:** load a graph, get the main metrics computed, visualised, and interactively explorable — no notebook, no `nx.degree_centrality(G)`, no boilerplate.

Developed for an academic project on visual analytics for knowledge graphs (Course on Visual Analytics, VAST Challenge 2025 — Design Challenge).

**Status:** v0.3.0 — work in progress, less than a prototype.
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

Telescope is a wiki-like surface organised in nine sections. Status of each section's chart panels:

| Section                    | Panels                                                                       | Done | Working | Sospeso |
| -------------------------- | ---------------------------------------------------------------------------- | :--: | :-----: | :-----: |
| Fundamentals               | graph representation, graph types                                            |      |         |         |
| Descriptive Metrics        | degree, paths, connectivity, density, clustering, reciprocity, edge weight   |      |         |         |
| Centrality                 | degree & eigenvector, Katz & PageRank, betweenness & closeness, comparison   |      |         |         |
| Local Structure            | ego network, triadic closure, bridges & weak ties, k-core                    |      |         |         |
| Mixing & Assortativity     | assortativity *r*, degree correlation, cross-type matrix                     |      |         |         |
| Generative Models          | ER, Watts–Strogatz, Barabási–Albert, model comparison                        |      |         |         |
| Resilience                 | random failure, targeted attack, edge removal                                |      |         |         |
| Temporal Analysis          | activity timeline, snapshot evolution                                        |      |         |         |
| Heterogeneous Structure    | type distribution, cross-type constraints, semantic violations               |      |         |         |

Each panel is meant to host a chart plus a theory drawer that explains what the user is looking at.

A schema endpoint inspects the loaded graph and drives:
- conditional panels (e.g. *Reciprocity* only for directed graphs, *Edge Weight* only when weighted, *Cross-type Matrix* only when heterogeneous),
- dynamic filters (node/edge types, degree, weight, attributes — numeric / categorical / boolean),
- the overview card with structural badges (multigraph, bipartite, DAG, self-loops).

---

## Stack

| Area     | Tech                                                          |
| -------- | ------------------------------------------------------------- |
| Frontend | Vue 3 · Vite · Pinia · Vue Router · Tailwind CSS v4 · Lucide  |
|          | D3 *(still missing — to power the Guide-mode chart panels)*   |
| Backend  | FastAPI · NetworkX                                            |

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

The API exposes `POST /upload/`, `POST /datasets/load/{name}`, `GET /schema/{graph_id}`, and a few legacy inspection endpoints (`/summary/`, `/node-types/`, `/edge-types/`). Registry is in-memory.

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

All iterations are on **Guide mode** — turning its sections from labelled placeholders into a connected, exploratory surface.

- **Real chart panels** — D3 charts driven by the loaded graph (degree distribution, centrality comparisons, k-core decomposition, etc.) — the *zero-code* photograph of the graph
- **Cross-panel links** — each panel references related concepts in other sections; clicking a term opens the linked panel and scrolls it into focus
- **Theory drawer with examples** — annotated with live snippets from the current graph, not generic prose ("your graph's top-3 hubs are X, Y, Z" instead of "hubs are nodes with high degree")
- **Schema-aware conditional panels** — already partially driven by `/schema/`, to be wired end-to-end so the wiki only shows what's applicable to the loaded graph

### Desiderata

A *didactic graph view*: a small live subgraph extracted from the loaded dataset that visually demonstrates each concept as the user reads about it (highlight a hub for *degree centrality*, colour a triangle for *triadic closure*, etc.). Same graph, different lenses — the wiki shows graph-theory concepts *through* the user's own data instead of with toy examples, useful both as a didactic device and as a quick visual sanity check on real data.

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
