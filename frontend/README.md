# Telescope — Frontend

Vue 3 (`<script setup>`) SPA built with Vite: Pinia + Vue Router, Tailwind CSS v4, D3 for
the chart panels, Lucide for icons, `@vueform/slider` for range controls. ESLint (flat
config) + Oxlint.

The cross-panel interaction contract is in [`docs/contract.md`](../docs/contract.md);
the D3 panel system in [`src/panels/README.md`](src/panels/README.md).

## Setup

```bash
npm install
npm run dev      # Vite dev server + HMR on :5173
npm run build
npm run preview
npm run lint
```

Requires Node `^20.19.0 || >=22.12.0`. The app calls FastAPI directly at
`http://localhost:8000` (`API_BASE` in `composables/useApi.js`); the backend's CORS
config allows the dev origin.

## Structure

```
src/
├── assets/main.css           # Tailwind entry + design-system utilities
├── router/index.js           # /dashboard (Graph + Guide nested views) + /dataset (onboarding)
├── utils/
│   ├── bitset.js             # Uint32-packed bitset (AND/OR/popcount) — the filter/selection masks
│   └── binsearch.js          # lower/upper bound for the degree-window mask
├── stores/                   # Pinia composition stores (in-memory unless noted)
│   ├── graph.js              # graphId (in-memory only — the API registry resets on restart)
│   ├── filters.js            # type chips, degree/weight, structural toggles, temporalFilter, nodeAttrs/edgeAttrs
│   ├── selection.js          # node + edge selection channels; replaceCapped + overflow; SELECTION_CAPS, MAX_LAYERS
│   ├── isolation.js          # per-panel Lock snapshots (full freeze)
│   ├── filterHistory.js      # filters-only undo/redo ring buffer (debounced)
│   ├── sidebars.js           # sidebar mode 'contents' | 'filters' (persisted)
│   ├── panels.js             # active panel set + ordering, per view (persisted)
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
│   ├── useDegreeFit / useComponents / useTypeMixing / useEdgeFlow / useTimeline / useEgoSubgraph
│   ├── useCentralityPoller.js + useCentrality / useAllCentralities   # single global poller + consumers
│   ├── useNodeInspect / useNodeNeighbors / useEdgeInspect  # sidebar inspector data
│   ├── useFilterShortcuts.js                               # "filter to this type/component" mutation helpers
│   ├── useForceGraph.js                                    # d3-force lifecycle (ego panels)
│   └── useDatasetLoader / useLocalStorage / useAboutModal / useTimelineSettingsModal / useAppVersion
├── components/
│   ├── AppSidebar.vue        # left sidebar shell: brand, GraphStatus identity, per-view body slot (RouterView), footer
│   ├── GraphStatus.vue       # parametric (section prop): identity row, counts card, node/edge inspectors
│   ├── GraphHeaderStrip.vue  # active-filter chips + undo/redo + reset (action-only chrome)
│   ├── GuideContents.vue     # panel registry list: search, sections, centrality status badges
│   ├── GuidePanel.vue        # grid card: header icons + controls drawer + dynamic panel + Lock
│   ├── PanelFocus.vue        # focus modal: chart (left) + theory drawer (right)
│   ├── NodeSearchInput.vue   # input + suggestions over the in-memory node index (ego panels)
│   ├── AboutModal.vue / TimelineParsingSettingsModal.vue
│   └── DashboardCard.vue     # card primitive for the Graph view grid
├── views/
│   ├── HomeView.vue          # dashboard frame: hosts the nested Graph/Guide views + their sidebars
│   ├── GraphView.vue / GraphSidebar.vue   # Graph view (node-link workspace) + its sidebar body
│   ├── GuideView.vue / GuideSidebar.vue   # Guide orchestrator (per-graph singletons, panel grid)
│   │                         #   + sidebar body: Contents/Filters toggle, GuideContents, AttributeFilters
│   └── DatasetView.vue       # onboarding: built-in picker + file upload
└── panels/                   # D3 viz panels (see src/panels/README.md)
```

Routing: `/` redirects to `/dashboard/`; `HomeView` hosts two nested named views —
`/dashboard/` (Graph) and `/dashboard/guide` (Guide) — each pairing a main component
with a sidebar body. A global guard redirects to `/dataset/` while no graph is loaded.

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

Use these — don't inline equivalent `border-slate-200` + shadow stacks ad-hoc
(data-encoding fills, e.g. heatmap cells, are the exception).

## Key conventions

- **`useFetch` / `createGraphResource` only** — never raw `fetch` + try/catch in
  components or composables.
- **Composables own side effects** — store resets and reactive fetches live in
  composables, not components.
- **`useD3Chart`** for static-chart D3 lifecycle; **`useForceGraph`** for force-directed.
- **Type colours are shared and effective-aware** — `useNodeTypeColors` /
  `useEdgeTypeColors`. Never a local `d3.scaleOrdinal` for types (same hue per type
  across all panels).
- **Deterministic layout** — use `seededUnit(id)` from `shared.js` for jitter, never
  `Math.random()` in a render (it reshuffles on every repaint).
- **Capped selection broadcasts** — `selection.replaceCapped(ids, cap)`, never `replace`
  + manual `.slice()` (overflow tracking drives the "+N more" caption).
- **Lucide for all icons** — no SVG copy-paste, no emoji as affordance.
- **`graphId` is in-memory only** — the API registry resets on server restart;
  persisting it would produce stale references.

## Team

Contributions to this folder, from the git history:

- **Salvo Rinzivillo** — initial project scaffolding: Vue 3 + Vite setup with Router,
  Pinia, and linting; Tailwind CSS integration; the first layout components
  (`DashboardCard`, early `HomeView`).
- **Giulia Fabiani** ([@g-fabiani4](https://github.com/g-fabiani4-unipi)) — reworked the
  dashboard into nested router views (Graph/Guide tabs with per-view sidebars),
  responsive layout for the dashboard and Graph view, accessibility pass (semantic tags
  and headings), Graph-view panel specs with per-view panel filtering, dataset-view
  loading skeletons, color-scale refactors.
- **Francesco Secoli** ([@sclfnc](https://github.com/sclfnc)) — the Telescope reference
  implementation: the D3 panels, the stores and composables (filter/selection bitmaps,
  panel context, Lock), the design system, onboarding, and the cross-panel contract.
