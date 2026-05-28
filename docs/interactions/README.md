# Interactions audit — index

This folder is the design document for filter↔panel and panel↔panel relationships in Telescope. It does **not** describe an implementation — it describes the current behaviour, the proposed additions, and the open questions that need a decision before any code changes.

## How to read these documents

Start here:

1. **[vocabulary.md](vocabulary.md)** — the labels and status flags used in every cell of every matrix.
2. **[filters.md](filters.md)** — what every filter slot means, who edits it, and how panels react.
3. **[panels/](panels/)** — one scheda per panel. Same 8-section template across all of them.
4. **[matrix_filters_panels.md](matrix_filters_panels.md)** — the Filters × Panels matrix. Reads top-to-bottom: how each filter affects each panel.
5. **[matrix_panels_panels.md](matrix_panels_panels.md)** — the Panels × Panels matrix. Reads row → column: actions in A that influence B. Not symmetric.
6. **[reverse_writes.md](reverse_writes.md)** — every panel that writes back into `filters.*` or shared state. Single source of truth for "where does data flow upstream".

Then circle back to individual schede when you want a deeper take on a panel.

## Scheda template

Every scheda inside [`panels/`](panels/) follows the same 8 sections:

1. **What it shows** — one paragraph, what the user sees.
2. **Data it reads** — endpoints, stores (read-only), filter masks.
3. **Selection & filter writes today** — what the panel writes, with caps if any.
4. **Filter sensitivity (per filter)** — one line per filter slot describing how the panel reacts.
5. **Proposed interactions — incoming (filters → panel)** — `[p]` / `[?]` proposals for "filter X should change behaviour Y", with cost tags.
6. **Proposed interactions — outgoing (panel → filter)** — `[p]` / `[?]` proposals for user gestures that should write filters.
7. **Proposed interactions — panel ↔ panel** — cross-panel proposals, both directions.
8. **Open questions / risks** — anything that needs a user decision (semantics, UX trade-offs, ping-pong risk).

## What "done" means for this doc

- Every implemented panel has a scheda. 16 entries (15 panel-registry implementations + `graph_status_inspector`).
- Both matrices are fully populated. `none [c]` is a valid cell.
- Every non-trivial matrix cell is also referenced in at least one scheda.
- The top open questions are listed below.

## Files in this folder

```
docs/interactions/
├── README.md                     ← this file
├── vocabulary.md
├── filters.md
├── matrix_filters_panels.md
├── matrix_panels_panels.md
├── reverse_writes.md
└── panels/
    ├── degree_distribution.md
    ├── connected_components.md
    ├── node_attribute_schema.md
    ├── edge_attribute_schema.md
    ├── cent_pagerank.md
    ├── cent_eigenvector.md
    ├── cent_betweenness.md
    ├── cent_closeness.md
    ├── cent_comparison.md
    ├── ego_network.md
    ├── ego_comparison.md
    ├── type_mixing.md
    ├── edge_flow.md
    ├── timeline_node.md
    ├── timeline_edge.md
    └── graph_status_inspector.md
```

## Top 10 — decisions taken

The questions below were resolved on 2026-05-27. The label after each title is the resolution; the body is the action item.

1. **Shift-click "lift to filter"** — **[○ leave as-is unless trivially clear]**. The shift-click gesture for "lift selection to filter" stays only where the discovery cost is near zero (visible affordance, tooltip). Where it would require a tutorial, prefer an explicit "Filter to this" button in the drawer. See [reverse_writes.md](reverse_writes.md) §Tier 1 / §Tier 2.
2. **Panel-local filters vs global chip group** — **[○ open, re-evaluate at panel refactor]**. `type_mixing` and `edge_flow` keep their local `edgeTypeFilter` for now; the unify-vs-scope-toggle call is deferred to whenever those panels are touched substantially. Don't add new panel-local filters in the meantime without flagging the question. See [type_mixing.md](panels/type_mixing.md), [edge_flow.md](panels/edge_flow.md).
3. **"Selection as filter"** — **[✕ defer]**. Promoting selection to a global filter slot would change the selection bus from a focus channel to a filter channel and inflate the AND-chain combinations. Lock already covers the "freeze this panel on the current view" need at panel scope; a global lens can be revisited if a real user request arrives. See [reverse_writes.md](reverse_writes.md) §Tier 4.
4. **Recompute-on-filtered toggles for centralities + degree** — **[✕ mask-only is the rule]**. All "recompute on filtered subgraph" proposals are rejected. Marks attenuate, derived quantities stay anchored to the full graph. The two documented client-side exceptions (`type_mixing`, `edge_flow` matrix/flow counts) stay as they are; no new exceptions. See [degree_distribution.md](panels/degree_distribution.md), [cent_pagerank.md](panels/cent_pagerank.md).
5. **Persistent brush rectangle on timelines** — **[✕ drop]**. Pipeline already complex; the cost (extra state to keep brush rectangle in sync with `temporalFilter`) outweighs the gain. Brush end → filter writes; visual feedback stays as today. See [timeline_node.md](panels/timeline_node.md), [timeline_edge.md](panels/timeline_edge.md).
6. **`cent_compare` selection wiring** — **[✓ align with the other four]**. Add `selection.ids` read for outline highlight, and a click handler on scatter dots / heat-cells. Scope of broader panel rework noted separately. See [cent_comparison.md](panels/cent_comparison.md).
7. **Selection caps captioning** — **[✓ add]**. `connectivity` (cap 500), `type_mixing` (cap 100), `edge_flow` (cap 200): show a small "+N more not selected" caption / tooltip when the cap kicks in. See [connected_components.md](panels/connected_components.md), [type_mixing.md](panels/type_mixing.md), [edge_flow.md](panels/edge_flow.md).
8. **Inspector vs. filter on focused node** — **[✓ badge "nascosto dal filtro"]**. When the focused node id is outside `activeNodeMask`, show a small badge on the inspector card. Same shape on the edge inspector. No auto-promote (don't silently clear filters). See [graph_status_inspector.md](panels/graph_status_inspector.md).
9. **Direction toggle (Out/In/Both)** — **[✓ shared]**. Single source of truth: a UI store slot consumed by `ego`, `ego_compare`, `cent_closeness`. Each panel still hides the toggle when its data is direction-insensitive (undirected graph for ego, direction-agnostic Generic view for closeness). See [cent_closeness.md](panels/cent_closeness.md), [ego_network.md](panels/ego_network.md).
10. **Edge palette consistency** — **[✓ unify]**. Hoist into a shared `useEdgeTypeColors(schemaRef)` composable mirroring `useNodeTypeColors`. `edge_flow` and `timeline_edge` switch to it; `type_mixing` aux bars + chip groups follow. See [timeline_edge.md](panels/timeline_edge.md).

### Cross-cutting principle

For every decided `[✓]` item, the rule is: **don't overcomplicate, just keep things coherent**. Prefer explicit affordances over hidden gestures, single source of truth over panel-local duplicates, drop-and-document over half-built abstractions. The schede below have been updated to reflect the resolution; the matrices stay descriptive (current state + retained proposals).

## What's intentionally NOT here

- Code changes. This is design only.
- Implementation timelines or sequencing — the user iterates on this doc and picks the order.
- Implementation details for the proposed interactions beyond the cost tag (`[low-cost]` / `[medium]` / `[expensive]`).
- Anything about the stub panels (`paths`, `density`, `clustering`, etc.). The registry has `status: 'planned'` / `'stub'` entries — those don't get schede yet.
