# panels/ — Interactive D3 Panels for Guide Mode

Self-contained Vue components rendered inside `GuidePanel`. Each panel:
- Fetches its own data via a dedicated composable (`useMetrics`, `useDegreeFit`, `useComponents`, `useGraphNodes`, `useCentrality`, `useEgoSubgraph`, `useTypeMixing`, `useEdgeFlow`, `useTimeline`, …) — or reads directly from the `useSchema` payload when the panel is metadata-only.
- Renders via `useD3Chart` (ResizeObserver + RAF + initial render) for static charts, or `useForceGraph` for force-directed (`EgoNetworkPanel`, `EgoComparisonPanel`).
- Exposes controls via `Teleport` into the collapsible drawer inside `GuidePanel`.
- Shows contextual theory text only inside the `PanelFocus` modal.

## Status

| Panel | ID | Component | Status |
|---|---|---|---|
| Degree Distribution | `degree` | `DegreeDistribution.vue` | ✓ implemented |
| Connected Components | `connectivity` | `ConnectedComponents.vue` | ✓ implemented |
| Node Attribute Schema | `node_attrs` | `AttributeSchema.vue` (`mode: 'node'`) | ✓ implemented |
| Edge Attribute Schema | `edge_attrs` | `AttributeSchema.vue` (`mode: 'edge'`) | ✓ implemented |
| PageRank | `cent_pagerank` | `CentralityPanel.vue` (`measure: 'pagerank'`) | ✓ implemented |
| Eigenvector | `cent_eigenvector` | `CentralityPanel.vue` (`measure: 'eigenvector'`) | ✓ implemented |
| Betweenness | `cent_betweenness` | `CentralityPanel.vue` (`measure: 'betweenness'`) | ✓ implemented |
| Closeness | `cent_closeness` | `CentralityPanel.vue` (`measure: 'closeness'`) | ✓ implemented |
| Centrality Comparison | `cent_compare` | `CentralityComparison.vue` | ✓ implemented |
| Ego Network | `ego` | `EgoNetworkPanel.vue` | ✓ implemented |
| Ego Comparison | `ego_compare` | `EgoComparisonPanel.vue` | ✓ implemented |
| Type Mixing Matrix | `type_mixing` | `TypeMixingMatrix.vue` | ✓ implemented |
| Edge Flow | `edge_flow` | `EdgeFlow.vue` | ✓ implemented |
| Activity Timeline | `timeline` | `ActivityTimeline.vue` | ✓ implemented |

Stub entries (~20) live in `ALL_SPECS` as roadmap reference and are filtered out from the UI export (`PANEL_SPECS = ALL_SPECS.filter(p => p.status !== 'stub')`). Promoting `stub → planned → implemented` is a one-field flip.

## File structure

```
panels/
├── index.js                    # ALL_SPECS + PANEL_SPECS (filtered export) + SECTIONS
├── usePanel.js                 # initializes per-panel `controls` reactive from controlsSchema.default
├── useD3Chart.js               # ResizeObserver + RAF wrapper for static D3 charts
├── shared.js                   # D3 utilities (scales, axes, colors, stats, formatters, correlations, tooltips)
├── layeredGraph.js             # pure helpers (fromEgoPayload, mergeLayers, filterIntersection) for ego panels
├── DegreeDistribution.vue
├── ConnectedComponents.vue
├── AttributeSchema.vue
├── CentralityPanel.vue
├── CentralityComparison.vue
├── EgoNetworkPanel.vue
├── EgoComparisonPanel.vue
├── TypeMixingMatrix.vue
├── EdgeFlow.vue
├── ActivityTimeline.vue
├── NotImplementedStub.vue      # placeholder for planned panels
└── controls/
    ├── ControlSection.vue      # drawer-section wrapper (title + optional actions slot)
    ├── ControlToggleGroup.vue  # pill segmented control — mutually exclusive options
    ├── ControlSwitch.vue       # on/off slider with inline label
    ├── ControlBoolean.vue      # eye/eye-off toggle, supports disabled prop
    └── SliderControl.vue       # `@vueform/slider` wrapped in `ControlSection` with standard padding
```

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
  componentProps: { mode: 'node' },                     // optional, for parametric panels (AttributeSchema, CentralityPanel)
  explanation: '...',                                   // static fallback for theory drawer
  contextualizeExplanation: (schema, data) => `...`,    // adapted text (preferred)
  controlsSchema: { ... },     // declarative spec — usePanel reads only `default` per field
}
```

## Authoring a new panel

Minimal skeleton (see existing panels for measure-specific variations):

```vue
<script setup>
import { ref, toRef, watch, nextTick } from 'vue'
import { useFooData } from '@/composables/useFoo.js'
import { usePanel } from './usePanel.js'
import { useD3Chart } from './useD3Chart.js'
import ControlSection from './controls/ControlSection.vue'

const props = defineProps({
  panelSpec:      { type: Object, required: true },
  schema:         { type: Object, default: null },
  graphId:        { type: String, default: null },
  widened:        { type: Boolean, default: false },
  controlsTarget: { type: String, default: null },
})
defineEmits(['request-widen', 'request-shrink'])

const { data, loading, error } = useFooData(toRef(props, 'graphId'))
const { controls, updateControl } = usePanel(props, props.panelSpec.id, data)

const containerRef = ref(null)
function render() { /* d3 logic — reads data.value, controls.value, props.schema */ }

watch([data, controls], () => nextTick(render), { deep: true })
useD3Chart(containerRef, render)
</script>

<template>
  <Teleport v-if="controlsTarget" :to="`#${controlsTarget}`">
    <div class="grid grid-cols-2 auto-rows-min gap-1.5">
      <ControlSection title="View"><!-- controls --></ControlSection>
    </div>
  </Teleport>
  <div ref="containerRef" class="chart-elev w-full" style="aspect-ratio: 4/3; position: relative;" />
</template>
```

## Controls drawer pattern

Controls are teleported into `GuidePanel`'s collapsible drawer (toggled by `SlidersHorizontal` in the panel header). The target div `id` is passed as `controlsTarget` prop — `null` until the drawer is mounted and ready (`drawerReady`). Always guard with `v-if="controlsTarget"` on the Teleport.

Layout inside the drawer: `grid grid-cols-2 auto-rows-min gap-1.5`. `ControlSection :col-span="2"` for full-width groups. `ControlToggleGroup` for mutually-exclusive pills, `ControlSwitch` for additive booleans, `ControlBoolean` for eye/eye-off, `SliderControl` for range sliders.

`controlsSchema` in the registry is read only for the `default` field by `usePanel.js`. Keep schema entries minimal (`{ default: <value> }`).

## Shared utilities (`shared.js`)

Constants: `COLOR_SCHEME`, `MARGINS_DEFAULT`, `LAYER_PALETTE` (4-hue ordinal for ego layers), `FIT_COLORS` (powerlaw / exponential / poisson / lognormal), `FORMATTERS` (number / integer / percent / siPrefix / exponential).

Stats: `pearson(xs, ys)`, `spearman(xs, ys) = pearson(rank(xs), rank(ys))`, `summaryStats(seq)` (mean/median/IQR/whisker bounds).

D3 helpers: `drawAxes(g, xScale, yScale, innerW, innerH, opts)`, `drawGrid(g, xScale, yScale, innerW, innerH)`, `drawLine(g, pts, xScale, yScale, color, dashArray, accessors)`, `drawTypeLegend(svg, totalW, types, typeColor)`.

Tooltips: `makeTooltip(container)` (creates a div), `showTip(tooltip, event, html)`, `hideTip(tooltip)`, `attachTooltip(selection, htmlFn, tooltip)` (binds mouseover/mousemove/mouseout in one call), `attachVLineTooltip(g, x, h, html, tooltip)`.

Formatters: `formatAttrSummary(attr)`, `formatCoverage(coverage)`.

Node-type colors come from `@/composables/useNodeTypeColors.js`, not from `shared.js` — share that mapping across panels rather than instantiating a local `d3.scaleOrdinal`.

## Cross-panel contract

- **`selection.ids`** is the universal cross-panel handoff (file: `@/stores/selection.js`). Panels with per-node marks write via `add`/`toggle`. Panels aggregating multiple ids per mark (e.g. TypeMixingMatrix cell click → nodes of two types) use `replace`. Cap by reading: `EgoComparisonPanel` reads `ids.slice(0, MAX_LAYERS)`.
- **`filters.*`** (file: `@/stores/filters.js`) is currently UI-only — the propagation refactor (see `PROPAGATION.md` at repo root) wires every panel to react to global filters via a Uint32-packed bitset (`useFilteredModel` → `usePanelContext`).
