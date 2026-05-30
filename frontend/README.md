# Telescope — Frontend

Vue 3 SPA built with Vite.

## Stack

- Vue 3 (`<script setup>`) + Vite + Pinia + Vue Router
- Tailwind CSS v4 (import-based, `@tailwindcss/vite`, no config file)
- D3.js for all chart panels
- Lucide Vue Next for icons (tree-shakeable named imports)
- `@vueform/slider` for dual-handle range controls
- ESLint (flat config) + Oxlint

## Setup

```bash
npm install
npm run dev      # Vite dev server + HMR on :5173
npm run build
npm run preview
npm run lint
```

Requires Node `^20.19.0 || >=22.12.0`. Vite proxies API calls to FastAPI on `:8000`.

## Structure

```
src/
├── assets/main.css           # Tailwind entry + design-system utilities
├── router/index.js           # / (dashboard) + /dataset (onboarding)
├── utils/
│   ├── bitset.js             # Uint32-packed bitset (AND/OR/popcount) — the filter/selection masks
│   └── binsearch.js          # lower/upper bound for the degree-window mask
├── stores/                   # Pinia composition stores (in-memory unless noted)
│   ├── graph.js              # graphId + mode ('graph' | 'guide')
│   ├── filters.js            # type chips, degree/weight, structural toggles, temporalFilter, nodeAttrs/edgeAttrs
│   ├── selection.js          # node + edge selection channels; replaceCapped + overflow; SELECTION_CAPS, MAX_LAYERS
│   ├── isolation.js          # per-panel Lock snapshots (full freeze)
│   ├── filterHistory.js      # filters-only undo/redo ring buffer (debounced)
│   ├── sidebars.js           # sidebar mode 'contents' | 'filters' (persisted)
│   ├── panels.js             # active panel set + ordering (persisted)
│   ├── uiPreferences.js      # shared direction toggle (ego / ego_compare / cent_closeness)
│   ├── typePromotion.js      # manual type-promotion overrides (scaffolding)
│   └── timelineOverrides.js  # per-attribute date-parsing strategy (persisted)
├── composables/              # reactive logic — data fetch + derived state
│   ├── useFetch.js / useApi.js / createGraphResource.js   # HTTP base + per-graph resource factory
│   ├── useSchema.js                                        # /schema/ + cross-graph teardown + effective-types prefetch
│   ├── useGraphNodes.js / useGraphEdges.js                 # SoA node/edge indices (provided singletons)
│   ├── useFilteredModel.js                                 # builds activeNodeMask / activeEdgeMask
│   ├── usePanelContext.js                                  # per-panel facade: masks + selectedMask + isActive/isSelected + Lock
│   ├── useEffectiveType(s).js                              # effective-type labels (auto-promotion)
│   ├── useAttributeIndex.js                                # per-(type,attr) filter bitsets (incl. text identifiers)
│   ├── useNodeTypeColors.js / useEdgeTypeColors.js         # deterministic, effective-aware type → hex
│   ├── useMetrics / useDegreeFit / useComponents / useTypeMixing / useEdgeFlow / useTimeline / useEgoSubgraph
│   ├── useCentralityPoller.js + useCentrality / useAllCentralities   # single global poller + consumers
│   ├── useNodeInspect / useNodeNeighbors / useEdgeInspect  # sidebar inspector data
│   ├── useFilterShortcuts.js                               # "filter to this type/component" mutation helpers
│   ├── useForceGraph.js                                    # d3-force lifecycle (ego panels)
│   └── useDatasetLoader / useLocalStorage / useAboutModal / useTimelineSettingsModal / useAppVersion
├── components/
│   ├── AppSidebar.vue        # left sidebar: brand, ModeToggle, GraphStatus, Contents/Filters toggle, footer
│   ├── GraphStatus.vue       # parametric (section prop): identity row, counts card, node/edge inspectors
│   ├── GraphHeaderStrip.vue  # active-filter chips + undo/redo + reset (action-only chrome)
│   ├── GuideContents.vue     # panel registry list: search, sections, centrality status badges
│   ├── GuidePanel.vue        # grid card: header icons + controls drawer + dynamic panel + Lock
│   ├── PanelFocus.vue        # focus modal: chart (left) + theory drawer (right)
│   ├── ModeToggle.vue        # Graph/Guide segmented toggle
│   ├── NodeSearchInput.vue   # input + suggestions over the in-memory node index (ego panels)
│   ├── AboutModal.vue / TimelineParsingSettingsModal.vue
│   └── DashboardCard.vue     # placeholder card for Graph mode grid
├── views/
│   ├── HomeView.vue          # mode switch: Graph (placeholder grid) or Guide
│   ├── DatasetView.vue       # onboarding: built-in picker + file upload
│   └── GuideView.vue         # Guide orchestrator: provides per-graph singletons, mounts the panel grid
└── panels/                   # D3 viz panels
    ├── index.js              # ALL_SPECS registry + PANEL_SPECS (filtered) + SECTIONS
    ├── usePanel.js           # initializes per-panel controls from controlsSchema.default
    ├── useD3Chart.js         # ResizeObserver + RAF wrapper for static D3 charts
    ├── shared.js             # D3 utils: scales, axes, formatters, correlations, tooltips, seededUnit, selectedTypesIn, idsOfTypesSoA
    ├── layeredGraph.js       # pure helpers for ego panels (fromEgoPayload / mergeLayers)
    ├── DegreeDistribution.vue
    ├── ConnectedComponents.vue
    ├── AttributeFilters.vue  # sidebar filter editor — parametric mode: 'node' | 'edge' (NOT registry-mounted)
    ├── CentralityPanel.vue   # parametric measure: 'pagerank' | 'eigenvector' | 'betweenness' | 'closeness'
    ├── CentralityComparison.vue
    ├── EgoNetworkPanel.vue / EgoComparisonPanel.vue
    ├── TypeMixingMatrix.vue / EdgeFlow.vue
    ├── ActivityTimeline.vue  # parametric mode: 'node' | 'edge'
    ├── NotImplementedStub.vue
    └── controls/             # ControlSection · ControlToggleGroup · ControlSwitch · ControlBoolean · SliderControl · RangeFilter
```

## The bitmap-truth contract

Common state lives in two Pinia stores (`filters`, `selection`) exposed as three shared bitmaps via
`usePanelContext`: `activeNodeMask` / `activeEdgeMask` (built once in `useFilteredModel`) and
`selectedMask` / `selectedEdgeMask`. Every panel **consumes** these to attenuate / outline marks;
panel-private `controls` (log scale, top-N, bin size) touch no bitmap. **Mask-only:** filters never
recompute metrics — the curve stays anchored to the full graph, the marks dim. The full contract
(the two count-view exceptions, upstream-write policy, anti-patterns) is in `contract.md` at repo root.

## Design system

Utility classes in `assets/main.css` (Tailwind `@utility`):

| Class | Use |
|---|---|
| `.card-elev` | Elevated card (border + drop shadow) |
| `.header-elev` | Sticky chrome (bottom border + downward shadow) |
| `.card-inset` | Inset depth for slot surfaces |
| `.segmented-track` / `.segmented-pill` | Segmented control vocabulary |
| `.type-chip` / `.type-chip--active` | Selectable rounded chip |
| `.input-base` | Input/select base style |

Use these — don't inline equivalent `border-slate-200` + shadow stacks ad-hoc (data-encoding fills,
e.g. heatmap cells, are the exception).

## Key conventions

- **`useFetch` / `createGraphResource` only** — never raw `fetch` + try/catch in components or composables.
- **Composables own side effects** — store resets, reactive fetches live in composables, not components.
- **`useD3Chart`** for static-chart D3 lifecycle; **`useForceGraph`** for force-directed.
- **Type colors are shared and effective-aware** — `useNodeTypeColors` / `useEdgeTypeColors`. Never a local `d3.scaleOrdinal` for types (same hue per type across all panels).
- **Deterministic layout** — use `seededUnit(id)` from `shared.js` for jitter, never `Math.random()` in a render (it reshuffles on every repaint).
- **Capped selection broadcasts** — `selection.replaceCapped(ids, cap)`, never `replace` + manual `.slice()` (overflow tracking drives the "+N more" caption).
- **Lucide for all icons** — no SVG copy-paste, no emoji as affordance.
- **`graphId` is in-memory only** — the API registry resets on server restart; persisting it would produce stale references.
