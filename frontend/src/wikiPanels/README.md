# wikiPanels — Interactive D3 Visualizations for Knowledge Graphs

Architecture for 27 interactive Guide-mode panels. Each panel:
- **Contextual explanation** adapted to the loaded dataset, shown only inside `PanelFocus` modal (theory drawer)
- **Panel-specific controls** declared in the registry, rendered automatically by `PanelShell`
- **D3 chart** mounted in a slot inside `PanelShell`

## File Structure

```
wikiPanels/
├── index.js                          # PANEL_SPECS registry + SECTIONS
├── panelProps.js                     # PANEL_PROPS — shared defineProps contract
├── usePanel.js                       # composable: ownSpec / controls / explanation / updateControl
├── PanelShell.vue                    # shared template: explanation + controls + slot
├── shared.js                         # D3 utilities (scales, colors, formatters, histogram)
│
├── DegreeDistribution.vue            # ✓ Implemented (reference for new panels)
├── Reciprocity.vue / EdgeWeight.vue / ... (26 placeholders)
│
└── controls/
    ├── index.js                      # CONTROL_COMPONENTS map
    ├── ControlSelect.vue / ControlBoolean.vue / ControlNumber.vue / ControlText.vue
```

## Authoring a Panel — Minimal Template

Every panel is ~10 lines of glue + the D3 rendering logic:

```vue
<script setup>
import { ref, onMounted, watch } from 'vue'
import { PANEL_PROPS } from './panelProps.js'
import { usePanel } from './usePanel.js'
import PanelShell from './PanelShell.vue'

const props = defineProps(PANEL_PROPS)
const { ownSpec, controls, explanation, updateControl } = usePanel(props)

const chartContainer = ref(null)
onMounted(() => renderChart())
watch(() => controls.value, renderChart, { deep: true })

function renderChart() {
  // d3 logic here, reads from controls.value and from your data source
}
</script>

<template>
  <PanelShell
    :explanation="explanation"
    :controls-schema="ownSpec?.controlsSchema"
    :controls="controls"
    :show-explanation="showExplanation"
    @update="updateControl"
  >
    <div ref="chartContainer" class="w-full bg-white rounded border border-slate-200" style="height: 400px;"></div>
  </PanelShell>
</template>
```

## Panel Specification Format

Each panel in `PANEL_SPECS` (`index.js`):

```javascript
{
  id: 'degree',
  label: 'Degree Distribution',
  section: '2. Descriptive Metrics',
  conditional: false,
  defaultActive: true,
  explanation: '...',                         // static fallback
  contextualizeExplanation: (schema, data) => `...`, // adapted to dataset
  component: DegreeDistribution,
  controlsSchema: {
    scale: { type: 'select', label: 'Scale', options: ['linear', 'log-x', 'log-y', 'log-log'], default: 'linear' },
    showBaseline: { type: 'boolean', label: 'Show ER Baseline', default: true },
  }
}
```

## Control Types

- `select`: `{ type: 'select', label, options: [...], default }`
- `boolean`: `{ type: 'boolean', label, default }`
- `number`: `{ type: 'number', label, min, max, step?, default }` — rendered as slider
- `text`: `{ type: 'text', label, default }`

## Data Flow (current — being replaced)

`useMetrics(graphId)` → fetches `/metrics/{graphId}` → panel reads `data.value.X`.

This will be replaced in Phase 3 of `todo.md` (root) by `useGraphData` + `useFilterMask` over typed arrays. New panels should not be wired up yet.

## Shared Utilities (`shared.js`)

- **Scales:** `createLinearScale(data, domain?, range?)`
- **Histogram:** `createHistogram(data, binCount?, accessor?)` — returns `[{ x0, x1, count, mid }]`
- **SVG container:** `createSvgContainer(element, width, height, margins?)` — returns `{ svg, g, innerWidth, innerHeight }`
- **Colors:** `COLOR_SCHEME` (nodeType, edgeType, accent, error, success, sequential, diverging)
- **Margins:** `MARGINS` (tight, standard, spacious)
- **Formatters:** `FORMATTERS` (number, integer, percent, siPrefix, exponential)
- **Transitions:** `TRANSITIONS` (fast, normal, slow)
