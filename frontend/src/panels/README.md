# panels/ — Interactive D3 Panels for Guide Mode

Self-contained Vue components rendered inside `GuidePanel`. Each panel:
- Fetches its own data via a dedicated composable (`useDegreeFit`, `useComponents`, `useCentrality`, `useEgoSubgraph`, …) — or reads the `useSchema` payload when metadata-only.
- Renders via `useD3Chart` (ResizeObserver + RAF) for static charts, or `useForceGraph` for force-directed (`EgoNetworkPanel`, `EgoComparisonPanel`).
- Exposes controls via `Teleport` into the collapsible drawer inside `GuidePanel`.
- Teleports an interactive theory block into the `PanelFocus` modal drawer (`#theoryTarget`).

> **The panel catalogue, the spec format, and how a panel binds to shared state are in
> [`docs/sclfnc/panels.md`](../../../docs/sclfnc/panels.md)**; the full cross-panel contract in
> [`docs/sclfnc/contract.md`](../../../docs/sclfnc/contract.md). This file is the authoring how-to.

## File structure

```
panels/
├── index.js                    # ALL_SPECS + PANEL_SPECS (filtered export) + SECTIONS
├── usePanel.js                 # initializes per-panel `controls` from controlsSchema.default
├── useD3Chart.js               # ResizeObserver + RAF wrapper for static D3 charts
├── shared.js                   # D3 utilities (scales, axes, colors, stats, formatters, correlations, tooltips)
├── layeredGraph.js             # pure helpers (fromEgoPayload, mergeLayers, filterIntersection) for ego panels
├── *.vue                       # one component per panel (see docs/sclfnc/panels.md for the catalogue)
├── NotImplementedStub.vue      # placeholder for planned panels
└── controls/
    ├── ControlSection.vue      # drawer-section wrapper (title + optional actions slot)
    ├── ControlToggleGroup.vue  # pill segmented control — mutually exclusive options
    ├── ControlSwitch.vue       # on/off slider with inline label
    ├── ControlBoolean.vue      # eye/eye-off toggle, supports disabled prop
    └── SliderControl.vue       # `@vueform/slider` wrapped in `ControlSection`
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

Controls are teleported into `GuidePanel`'s collapsible drawer (toggled by `SlidersHorizontal` in the
panel header). The target div `id` is passed as `controlsTarget` — it is `null` until the drawer is
mounted and ready (`drawerReady`). Always guard the Teleport with `v-if="controlsTarget"`.

Layout inside the drawer: `grid grid-cols-2 auto-rows-min gap-1.5`. `ControlSection :col-span="2"` for
full-width groups. `ControlToggleGroup` for mutually-exclusive pills, `ControlSwitch` for additive
booleans, `ControlBoolean` for eye/eye-off, `SliderControl` for range sliders. `controlsSchema` in the
registry is read only for the `default` field by `usePanel.js`; keep entries minimal (`{ default: <value> }`).

## Shared utilities (`shared.js`)

- **Constants:** `COLOR_SCHEME` (semantic + sky accents), `SLATE` (neutral grey scale), `MARGINS_DEFAULT`, `LAYER_PALETTE` (4-hue ordinal for ego layers), `FORMATTERS` (number / integer / percent / siPrefix / exponential).
- **Stats:** `pearson(xs, ys)`, `spearman(xs, ys)`, `summaryStats(seq)` (mean/median/IQR/whisker bounds).
- **D3 helpers:** `drawAxes`, `drawGrid`, `drawLine`, `drawTypeLegend(svg, totalW, types, typeColor)`.
- **Tooltips:** `makeTooltip(container)`, `showTip`, `hideTip`, `attachVLineTooltip`. Theory links: `theoryLinkClass(on)`.
- **Formatters:** `formatAttrSummary(attr)`, `formatCoverage(coverage)`.

Node-type colours come from `@/composables/useNodeTypeColors.js`, not from `shared.js` — share that
mapping across panels rather than instantiating a local `d3.scaleOrdinal`. Use `seededUnit(id)` for
deterministic jitter, never `Math.random()` in a render.
