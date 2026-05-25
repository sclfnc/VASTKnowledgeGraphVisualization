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
├── assets/main.css           # Tailwind entry + design system utilities
├── router/index.js           # / (dashboard) + /dataset (onboarding)
├── stores/
│   ├── graph.js              # graphId (in-memory) + mode ('graph'|'guide')
│   ├── filters.js            # node/edge type filters, numeric, hideIsolated, hideSelfLoops, temporalFilter
│   ├── selection.js          # cross-panel selection ids (add/toggle/replace/clear) + MAX_LAYERS
│   ├── panels.js             # active panel set + ordered list + GUIDE_PANELS_KEY
│   └── timelineOverrides.js  # per-attribute date-parsing strategy overrides
├── composables/
│   ├── useApi.js                  # apiUrl(path) — centralized backend host
│   ├── useFetch.js                # shared { data, loading, error, run }
│   ├── createGraphResource.js     # factory: (path) → composable (graphIdRef) → { data, loading, error }
│   ├── useSchema.js               # reactive /schema/{graphId}, resets filters store
│   ├── useMetrics.js              # reactive /metrics/{graphId}
│   ├── useDegreeFit.js            # reactive /degree-fit/{graphId}
│   ├── useComponents.js           # reactive /components/{graphId}
│   ├── useGraphNodes.js           # reactive /nodes/{graphId} (full node index)
│   ├── useEgoSubgraph.js          # debounced /ego/{graphId}/{nodeId}
│   ├── useTypeMixing.js           # reactive /type-mixing/{graphId}
│   ├── useEdgeFlow.js             # reactive /edge-flow/{graphId}
│   ├── useTimeline.js             # reactive /timeline/{graphId}
│   ├── useCentralityPoller.js     # single global poller for /centrality-status/ + data
│   ├── useCentrality.js           # per-measure consumer (inject from poller)
│   ├── useAllCentralities.js      # all-measures consumer (CentralityComparison)
│   ├── useForceGraph.js           # d3-force lifecycle composable (used by ego panels)
│   ├── useNodeTypeColors.js       # deterministic nodeType → hex (Tableau10)
│   ├── useDatasetLoader.js        # loadBuiltin / uploadFile / fetchDatasets
│   ├── useLocalStorage.js         # module-level cache, shared refs per key
│   ├── useAboutModal.js           # about modal open/close state
│   └── useTimelineSettingsModal.js # ActivityTimeline date-parsing settings modal
├── components/
│   ├── AppSidebar.vue        # left sidebar wrapper (GuideContents host)
│   ├── HeaderControls.vue    # header right-side controls (About/Dataset/Mode)
│   ├── ModeToggle.vue        # Graph/Guide segmented toggle (dark + light variants)
│   ├── DatasetDropdown.vue   # dataset switcher dropdown
│   ├── GuideContents.vue     # panel list: search, sections, badges, load/remove all
│   ├── GuidePanel.vue        # grid card: header icons + collapsible controls drawer + dynamic panel
│   ├── GraphContextBar.vue   # context + filters card above the panel grid
│   ├── PanelFocus.vue        # focus modal: chart (left) + theory drawer (right)
│   ├── AboutModal.vue        # about modal (Teleport, card-elev style)
│   ├── DashboardCard.vue     # placeholder card for Graph mode grid
│   ├── NumericFilter.vue     # numeric filter widget (absolute / percentile / IQR)
│   └── NodeSearchInput.vue   # input + suggestions over in-memory node index (used by ego panels)
├── views/
│   ├── HomeView.vue          # mode switch: Graph (placeholder grid) or Guide
│   ├── DatasetView.vue       # onboarding: built-in picker + file upload
│   └── GuideView.vue         # Guide orchestrator: schema, panel state, focus state
└── panels/                   # D3 viz panels (renamed from wikiPanels/ in refactor F10)
    ├── index.js              # ALL_SPECS registry + PANEL_SPECS (filtered) + SECTIONS
    ├── usePanel.js           # initializes per-panel controls from controlsSchema.default
    ├── useD3Chart.js         # ResizeObserver + RAF wrapper for static D3 charts
    ├── shared.js             # D3 utils: scales, axes, colors, formatters, correlations, tooltips
    ├── layeredGraph.js       # pure helpers for ego panels (fromEgoPayload / mergeLayers)
    ├── DegreeDistribution.vue
    ├── ConnectedComponents.vue
    ├── AttributeSchema.vue   # parametric mode: 'node' | 'edge'
    ├── CentralityPanel.vue   # parametric measure: 'pagerank' | 'eigenvector' | 'betweenness' | 'closeness'
    ├── CentralityComparison.vue
    ├── EgoNetworkPanel.vue
    ├── EgoComparisonPanel.vue
    ├── TypeMixingMatrix.vue
    ├── EdgeFlow.vue
    ├── ActivityTimeline.vue
    ├── NotImplementedStub.vue
    └── controls/
        ├── ControlSection.vue       # drawer-section wrapper (rounded card + title + slot)
        ├── ControlToggleGroup.vue   # pill segmented control
        ├── ControlSwitch.vue        # on/off slider with label
        ├── ControlBoolean.vue       # eye/eye-off toggle
        └── SliderControl.vue        # @vueform/slider wrapped in ControlSection
```

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

Always use these — don't inline equivalent `border-slate-200` + shadow stacks ad-hoc.

## Key conventions

- **`useFetch` only** — never raw `fetch` + try/catch inside components or composables.
- **Composables own side effects** — store resets, reactive fetches, etc. live in composables.
- **`useD3Chart`** for D3 lifecycle (ResizeObserver + RAF + initial render).
- **`useNodeTypeColors`** for node-type color mapping — never a local `d3.scaleOrdinal`.
- **Lucide for all icons** — no SVG copy-paste, no emoji as affordance.
- **`graph_id` is in-memory only** — the API registry resets on server restart; persisting it would produce stale references.
