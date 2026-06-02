# Telescope — Design

> *Zoom into your graph.* A visual-analytics prototype for the structured first exploration
> of attributed knowledge graphs. Zero-code: load a graph, get the main metrics computed,
> visualised, and interactively explorable — no notebook, no `nx.degree_centrality(G)`.

Developed for the Course on Visual Analytics (VAST Challenge 2025 — Design Challenge). All the work
went into **Guide mode**; Graph mode is a placeholder on purpose.

## Who it is for

Two audiences, one surface:

- **Data scientists** approaching a new graph who want a structured first pass — degree
  distribution, centralities, components, assortativity — without writing code. Each panel is a
  metric *photographed* on the loaded data and made interactive.
- **Non-expert users** (the VAST Challenge target) who want to understand what those metrics mean,
  and what a "normal" or "anomalous" reading looks like, through a theory drawer on every panel.

The data scientist reads the chart, the non-expert reads the explanation, both drill into the same
focus modal.

## How it stays in sync

Every panel reacts to global filters and selection through **three shared bitmaps**
(`activeNodeMask`, `activeEdgeMask`, `selectedMask`), built once in `useFilteredModel` /
`usePanelContext`. **Mask-only semantics:** filters dim marks, they do not recompute metrics —
a power-law fit or a Gini curve stays anchored to the full graph while the marks fade. Per-panel
Isolation (Lock) freezes a card on its current view. The full cross-panel contract — what each store
owns, the two count-view exceptions, the upstream-write policy — is in [contract.md](contract.md).

## Built-in datasets

Six datasets are exposed via `GET /datasets/`:

- **karate** — Zachary's Karate Club (auto-promoted on `club`: Mr. Hi / Officer)
- **les_miserables** — co-appearance graph
- **florentine** — Florentine families
- **davis** — Davis Southern Women (bipartite, auto-promoted on `bipartite`)
- **email_eu_core** — Email Eu-Core (directed, real department node types)
- **movielens_small** — MovieLens Small (larger, weighted, temporal)

The NetworkX built-ins load as-is — no synthetic `Node Type` is added. Single-type graphs with one
discriminator attribute (Karate's `club`, Davis' `bipartite`) go through **auto-promotion**: that
attribute becomes the effective type everywhere (colours, legends, chip group); les_misérables and
florentine show as a single type. The two larger built-ins (email-eu-core, MovieLens) carry real
`Node Type` / `Edge Type` set by their loaders.

## Scope and limitations

Design decisions, not oversights:

- **Read-only.** No graph editing; the tool is for exploration and screening, not authoring.
- **No persistence.** In-memory registry; a restart clears loaded graphs. Acceptable for a prototype
  with no auth and no multi-user requirement.
- **Scale ceiling ~100K edges.** Frontend SoA + bitset and backend NetworKit handle MC1 and MovieLens
  comfortably; far larger graphs would need a binary wire format and server-side masking, which is out
  of scope on purpose.
- **No layout breadth.** Not a Gephi replacement. It covers the *exploratory* phase that comes before a
  full layout/community workflow — the moment when the analyst has not yet decided which metric matters.
- **Mask-only everywhere but two count views.** A documented choice (see [contract.md](contract.md)),
  not a limitation to apologise for.
- **Multigraph parallel edges in Ego Comparison.** `mergeLayers` (`panels/layeredGraph.js`) groups
  edges by `(source, target, type)`, so parallel edges collapse to one visual record referencing the
  first `edge_id`. The single-ego view (`EgoNetworkPanel`) preserves every parallel edge.

## Notes on MC1

The reference dataset (`data/MC1_release/MC1_graph.json`) is a directed multigraph: 17,412 nodes /
37,857 edges, 16 weakly connected components, LCC covers >99%. Five node types (`Person`, `Song`,
`RecordLabel`, `Album`, `MusicalGroup`), twelve edge types. Centralities are computed via NetworKit
because pure NetworkX is too slow at this scale.

## Coming next

The next batch of panels (stub → planned → implemented) covers triadic closure, k-core decomposition,
assortativity, degree correlation, and community detection (Louvain / Label Propagation).
