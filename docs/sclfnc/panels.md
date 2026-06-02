# D3 Panels

Self-contained Vue components rendered inside `GuidePanel` (Guide mode). Each panel fetches its own
data via a dedicated composable, renders through `useD3Chart` (static) or `useForceGraph`
(force-directed), exposes controls via `Teleport` into the drawer, and teleports a theory block into
the `PanelFocus` modal.

The hands-on guide (authoring a new panel, the controls-drawer pattern, the `shared.js` utilities) is
in [`frontend/src/panels/README.md`](../../frontend/src/panels/README.md), next to the code. This page
is the catalogue and the design. The cross-panel contract is in [contract.md](contract.md).

## Catalogue

| Panel | ID | Component | Status |
|---|---|---|---|
| Degree Distribution | `degree` | `DegreeDistribution.vue` | ✓ implemented |
| Connected Components | `connectivity` | `ConnectedComponents.vue` | ✓ implemented |
| PageRank | `cent_pagerank` | `CentralityPanel.vue` (`measure: 'pagerank'`) | ✓ implemented |
| Eigenvector | `cent_eigenvector` | `CentralityPanel.vue` (`measure: 'eigenvector'`) | ✓ implemented |
| Betweenness | `cent_betweenness` | `CentralityPanel.vue` (`measure: 'betweenness'`) | ✓ implemented |
| Closeness | `cent_closeness` | `CentralityPanel.vue` (`measure: 'closeness'`) | ✓ implemented |
| Centrality Comparison | `cent_compare` | `CentralityComparison.vue` | ✓ implemented |
| Ego Network | `ego` | `EgoNetworkPanel.vue` | ✓ implemented |
| Ego Comparison | `ego_compare` | `EgoComparisonPanel.vue` | ✓ implemented |
| Type Mixing Matrix | `type_mixing` | `TypeMixingMatrix.vue` | ✓ implemented |
| Edge Flow | `edge_flow` | `EdgeFlow.vue` | ✓ implemented |
| Activity Timeline | `timeline_node` / `timeline_edge` | `ActivityTimeline.vue` (`mode: 'node' \| 'edge'`) | ✓ implemented |

`AttributeFilters.vue` (`mode: 'node' | 'edge'`) is the sidebar filter editor — **not** in the panel
registry; `AppSidebar` mounts it directly when `sidebars.mode === 'filters'`. Stub entries (~20) live
in `ALL_SPECS` as a roadmap reference and are left out of the UI export
(`PANEL_SPECS = ALL_SPECS.filter(p => p.status !== 'stub')`). Moving a panel `stub → planned →
implemented` is a one-field change.

## Panel spec format (`index.js`)

```js
{
  id: 'degree',
  label: 'Degree Distribution',
  section: '2. Descriptive Metrics',
  conditional: false,         // true = only shown when schema conditions met
  defaultActive: true,
  status: 'implemented',      // 'implemented' | 'planned' | 'stub'
  component: DegreeDistribution,
  componentProps: { mode: 'node' },                     // optional, for parametric panels
  available: (schema) => true,                          // optional predicate — hide when data absent
  controlsSchema: { ... },     // declarative spec — usePanel reads only `default` per field
}
// Theory text is not a spec field: each component Teleports an interactive block into
// PanelFocus's #theoryTarget drawer (it receives controls + live data).
```

## How a panel binds to shared state

- **`filters.*`** → `useFilteredModel` builds `activeNodeMask` / `activeEdgeMask` (Uint32-packed
  bitsets). Panels read them via `usePanelContext` and **dim** marks — mask-only: filters never
  recompute metrics. The two count-view exceptions (`type_mixing` / `edge_flow`) recompute aggregate
  counts under the edge mask. No panel reads `filters.*` raw to skip a mask; the only allowed raw
  read shows the state of a widget the panel itself edits (`ConnectedComponents` → `wccFilter` for its
  Top-N button state).
- **`selection.ids` / `selection.edgeIds`** → `selectedMask` / `selectedEdgeMask` + predicates
  `isSelected(id)` / `isEdgeSelected(edgeId)`. Per-node marks write via `add`/`toggle`; aggregate
  broadcasts use `replaceCapped(ids, SELECTION_CAPS[id])` so the store tracks overflow for the
  "+N more" caption. `EgoComparisonPanel` caps on read (`ids.slice(0, MAX_LAYERS)`).
- **Isolation (Lock)** freezes a panel on a deep-cloned snapshot of filters + selection + all masks;
  `usePanelContext` resolves to the snapshot while frozen.

Full detail, including the upstream-write policy and the open-ideas backlog, in [contract.md](contract.md).
